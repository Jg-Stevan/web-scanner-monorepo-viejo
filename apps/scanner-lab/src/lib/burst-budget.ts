"use client";

/**
 * PERF/burst-budget — Presupuesto de TIEMPO + salida por ESTABILIDAD para la
 * adquisición de la captura (tramo `capture_fired` → `capture_shot`).
 *
 * Evidencia (lote 3, qa-standard-v1.1, build 97dbe66): el gap de adquisición
 * en gama baja era ~16.8 s (A13) frente a ~0.22 s (iPhone) — superlineal
 * respecto de la CPU (3.5×). La adquisición real es una CADENA de esperas
 * (torch → carrera de takePhoto 5 s ×2 → clamp del blob → FileReader), no
 * un bucle por nº de frames: cada espera tiene su PROPIO tope y ninguna
 * cuenta el total. Este módulo impone el muro global que la cadena no tenía.
 *
 *   §A — Muro de tiempo: BURST_TIME_BUDGET_MS = 2000 desde capture_fired
 *        (reloj monotónico performance.now(); NUNCA rAF — a trompicones en
 *        gama baja con ahorro de batería). Límite DURO: al llegar, la
 *        adquisición termina con lo recogido (`time_cap`).
 *   §B — Salida por estabilidad: miniatura de 64×64 del preview (señal
 *        BARATA, prohibido comparar a 4032 px); `stabilityFrames` deltas
 *        consecutivos por debajo del umbral → `stable`.
 *   §C — Techo de frames como MÁXIMO: el dispatch de respaldo ya recolecta
 *        ≤3 candidatos y el ring ZSL ≤8 (límites existentes INTACTOS).
 *
 * Config de diagnóstico (patrón `__diagTools` / `__tierTools`):
 *
 *   window.__burstTools = {
 *     set({ enabled, timeBudgetMs, stabilityFrames, stabilityThreshold }),
 *     get(),   // config vigente
 *     reset(), // vuelve a defaults
 *   }
 *
 * `enabled: false` → la captura corre el camino legacy EXACTO (A/B del dueño
 * en la misma sesión). Telemetría por captura: `window.__lastBurst` (patrón
 * `__lastShutter`) + meta aditiva en el mark `capture_shot`
 * (`burstExitReason` / `burstFrames`).
 */

/** Por qué terminó la adquisición. Los 5 valores de la spec + `photo`
 * (extensión aditiva: la foto del sensor llegó DENTRO del presupuesto y fue
 * despachada — sin este valor no se distinguiría el camino normal del error). */
export type BurstExitReason =
  | "photo" // la foto full-sensor llegó dentro del presupuesto (camino normal)
  | "stable" // §B: N deltas consecutivos de preview < umbral → no esperar más
  | "time_cap" // §A: muro de tiempo agotado → dispatch con lo recogido
  | "frame_cap" // §C: dispatch de frames al techo de 3 candidatos (sin foto)
  | "error" // nada despachable (stream muerto / encode fallido)
  | "legacy"; // __burstTools.set({ enabled:false }) — camino exacto de antes

export interface BurstBudgetConfig {
  /** false = comportamiento legacy EXACTO (sin muro, sin sampler). */
  enabled: boolean;
  /** §A — muro global de la adquisición, en ms desde capture_fired. */
  timeBudgetMs: number;
  /** §B — deltas consecutivos bajo umbral necesarios para salir por estable. */
  stabilityFrames: number;
  /** §B — umbral del delta (luma medio absoluto por píxel, 0-255). */
  stabilityThreshold: number;
}

const DEFAULTS: BurstBudgetConfig = {
  enabled: true,
  timeBudgetMs: 2000,
  stabilityFrames: 2,
  stabilityThreshold: 2.5,
};

/** §B — cadencia del sampler de estabilidad. 750 ms → la salida `stable`
 * más temprana es ~1.5 s tras capture_fired: la foto de iPhone (~0.22 s) y
 * A56 (~1.05 s) SIEMPRE gana antes (criterio QA «sin regresión»); solo un
 * disparo ya patológico (>1.5 s) se corta por estabilidad. */
const STABILITY_SAMPLE_INTERVAL_MS = 750;
/** Cadencia de revisión del muro/promesas (ms). */
const WATCH_TICK_MS = 100;

let config: BurstBudgetConfig = { ...DEFAULTS };

export function getBurstConfig(): BurstBudgetConfig {
  return config;
}

/** Estadísticas de UNA adquisición (telemetría QA, `window.__lastBurst`). */
export interface BurstStats {
  at: number;
  exitReason: BurstExitReason;
  /** Nº de frames que el dispatch consideró (foto = 1). */
  frames: number;
  /** ms desde capture_fired hasta la decisión de salida. */
  waitedMs: number;
  /** Bytes de la foto despachada (solo camino photo). */
  photoBytes: number | null;
  /** Muestras de estabilidad tomadas durante la espera (§B). */
  samples: number;
  /** Coste de la ÚLTIMA muestra (ms) — objetivo < 10 ms en clase A13. */
  lastSampleCostMs: number | null;
}

let lastStats: BurstStats | null = null;

/** Registra la salida de una adquisición: actualiza `window.__lastBurst` y
 *  devuelve el registro (el llamador lo cuelga del mark capture_shot). */
export function recordBurst(
  exitReason: BurstExitReason,
  frames: number,
  waitedMs: number,
  extra?: { photoBytes?: number; samples?: number; lastSampleCostMs?: number | null }
): BurstStats {
  lastStats = {
    at: Date.now(),
    exitReason,
    frames,
    waitedMs: Math.round(waitedMs),
    photoBytes: extra?.photoBytes ?? null,
    samples: extra?.samples ?? 0,
    lastSampleCostMs: extra?.lastSampleCostMs ?? null,
  };
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__lastBurst = { ...lastStats };
  }
  return lastStats;
}

export function getLastBurst(): BurstStats | null {
  return lastStats;
}

/* ── §B — sampler de estabilidad (señal BARATA) ─────────────────────────── */

/** Miniaturas 64×64 del <video> vivo → luma; `sample()` devuelve el delta
 *  medio absoluto contra la muestra ANTERIOR (o null si no hay baseline/video).
 *  Coste objetivo: < 10 ms por muestra en hardware clase A13 (se mide y
 *  reporta). PROHIBIDO comparar frames a resolución completa. */
export interface ThumbSampler {
  /** Fija la referencia inicial (al empezar la espera de la foto). */
  baseline(): void;
  /** Delta de luma (0-255) vs la muestra anterior, o null sin referencia. */
  sample(): number | null;
}

const THUMB_SIZE = 64;

export function makeThumbSampler(
  getVideo: () => HTMLVideoElement | null
): ThumbSampler {
  let prev: Uint8Array | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const grab = (): Uint8Array | null => {
    const video = getVideo();
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    try {
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = THUMB_SIZE;
        canvas.height = THUMB_SIZE;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, THUMB_SIZE, THUMB_SIZE);
      const d = ctx.getImageData(0, 0, THUMB_SIZE, THUMB_SIZE).data;
      const luma = new Uint8Array(THUMB_SIZE * THUMB_SIZE);
      for (let i = 0, j = 0; j < luma.length; i += 4, j++) {
        luma[j] = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
      }
      return luma;
    } catch {
      return null;
    }
  };

  return {
    baseline() {
      prev = grab();
    },
    sample(): number | null {
      const cur = grab();
      if (cur === null) return null; // sin video: conserva la referencia vieja
      if (prev === null || prev.length !== cur.length) {
        prev = cur;
        return null; // primera muestra efectiva: solo fija referencia
      }
      let sum = 0;
      for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i]! - prev[i]!);
      prev = cur;
      return sum / cur.length;
    },
  };
}

/* ── Espera presupuestada (§A + §B sobre la foto del sensor) ────────────── */

export interface BurstWaitOutcome {
  /** "value" = la operación terminó (resultado en `value`, puede ser null);
   *  "time_cap" | "stable" = el presupuesto cortó la espera. */
  settled: "value" | "time_cap" | "stable";
  value: unknown;
  /** Muestras de estabilidad tomadas durante la espera. */
  samples: number;
  /** Coste de la última muestra (ms) — telemetría del objetivo < 10 ms. */
  lastSampleCostMs: number | null;
}

/** Espera `start()` (la foto del sensor) bajo el presupuesto: termina cuando
 *  la operación resuelve, cuando vence el muro (`time_cap`) o cuando el
 *  preview lleva `stabilityFrames` muestras consecutivas estables (`stable`).
 *  El reloj es performance.now() (monotónico) — NUNCA rAF. */
export function waitForPhotoBudget(
  start: () => Promise<unknown>,
  opts: { deadlineAt: number; sampler: ThumbSampler }
): Promise<BurstWaitOutcome> {
  const cfg = config; // snapshot: cambios vía __burstTools aplican a la SIGUIENTE captura
  return new Promise<BurstWaitOutcome>((resolve) => {
    let settled = false;
    let samples = 0;
    let stableCount = 0;
    let lastSampleCostMs: number | null = null;
    let nextSampleAt = performance.now() + STABILITY_SAMPLE_INTERVAL_MS;

    const finish = (r: BurstWaitOutcome) => {
      if (settled) return;
      settled = true;
      window.clearInterval(iv);
      resolve(r);
    };

    // La operación puede ganar la carrera (foto a tiempo) — el ORFANO no
    // abortable queda documentado: ImageCapture no expone cancelación.
    void start().then(
      (value) => finish({ settled: "value", value, samples, lastSampleCostMs }),
      () => finish({ settled: "value", value: null, samples, lastSampleCostMs })
    );

    const iv = window.setInterval(() => {
      const now = performance.now();
      // §A — muro DURO: la adquisición termina con lo recogido.
      if (now >= opts.deadlineAt) {
        finish({ settled: "time_cap", value: null, samples, lastSampleCostMs });
        return;
      }
      if (now < nextSampleAt) return;
      nextSampleAt = now + STABILITY_SAMPLE_INTERVAL_MS;
      const t0 = performance.now();
      const delta = opts.sampler.sample();
      lastSampleCostMs = Math.round((performance.now() - t0) * 100) / 100;
      if (delta === null) return;
      samples += 1;
      // §B — deltas consecutivos bajo umbral → los frames extra no aportan.
      stableCount = delta < cfg.stabilityThreshold ? stableCount + 1 : 0;
      if (stableCount >= cfg.stabilityFrames) {
        finish({ settled: "stable", value: null, samples, lastSampleCostMs });
      }
    }, WATCH_TICK_MS);
  });
}

/* ── Sonda de QA (patrón __diagTools / __sensorTools) ───────────────────── */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__burstTools = {
    set(partial: Partial<BurstBudgetConfig>) {
      const p = partial ?? {};
      const next = { ...config };
      if (typeof p.enabled === "boolean") next.enabled = p.enabled;
      if (typeof p.timeBudgetMs === "number" && Number.isFinite(p.timeBudgetMs)) {
        next.timeBudgetMs = Math.max(0, Math.min(60_000, p.timeBudgetMs));
      }
      if (
        typeof p.stabilityFrames === "number" &&
        Number.isFinite(p.stabilityFrames)
      ) {
        next.stabilityFrames = Math.max(1, Math.min(10, Math.round(p.stabilityFrames)));
      }
      if (
        typeof p.stabilityThreshold === "number" &&
        Number.isFinite(p.stabilityThreshold)
      ) {
        next.stabilityThreshold = Math.max(0, Math.min(255, p.stabilityThreshold));
      }
      config = next;
      return { ...config };
    },
    get(): BurstBudgetConfig {
      return { ...config };
    },
    reset(): BurstBudgetConfig {
      config = { ...DEFAULTS };
      return { ...config };
    },
  };
}
