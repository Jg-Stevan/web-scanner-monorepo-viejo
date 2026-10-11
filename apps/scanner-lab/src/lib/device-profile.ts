/**
 * FIX v13 (13.1) — Perfil de hardware del dispositivo EN RUNTIME.
 *
 * Las señales de hardware (cores, memoria, UA) hasta ahora solo viajaban al
 * crash-reporter post-mortem. Aquí quedan consultables EN VIVO:
 *  · `getDeviceProfile()` — lectura síncrona para la UI/diagnóstico.
 *  · `window.__deviceProfile` — telemetría QA del dueño (consola remota):
 *    { tier, cores, memoryGB, ua, dpr, touch, benchMs, ts }.
 *
 * ⛔ El tier NO cambia comportamiento de captura ni de análisis (eso es
 * territorio v12). Solo alimenta: el campo `tier` del crash-reporter
 * (aditivo), el banner informativo de 13.4 y el informe v13.
 *
 * Inicialización SIN tocar page.tsx: este módulo se auto-inicializa al ser
 * importado (crash-reporter lo importa — y ese ya se llama a nivel de módulo
 * en page.tsx, antes de cualquier hunk v12). Lectura instantánea desde
 * localStorage (TTL 24 h) + micro-benchmark en idle (una vez por sesión).
 */

/** Tier de hardware — SOLO diagnóstico, nunca cambia el pipeline. */
export type DeviceTier = "bajo" | "medio" | "alto";

/** Señales crudas del navegador (sin benchmark). */
type HardwareSignals = {
  /** navigator.hardwareConcurrency (null si el navegador no lo expone). */
  cores: number | null;
  /** navigator.deviceMemory en GB (null fuera de Chromium). */
  memoryGB: number | null;
  /** UA completo. */
  ua: string;
  /** Plataforma parseada del UA (ios / android / otro). */
  platform: "ios" | "android" | "otro";
  /** Versión MAYOR de iOS/Android parseada del UA (null si desconocida). */
  osMajor: number | null;
  /** devicePixelRatio. */
  dpr: number;
  /** maxTouchPoints. */
  touch: number;
  /** window.isSecureContext. */
  secure: boolean;
  /** matchMedia: (prefers-reduced-motion: reduce). */
  reducedMotion: boolean;
  /** matchMedia: (pointer: coarse). */
  coarsePointer: boolean;
};

/** Registro interno completo (el del caché localStorage). FIX v13-post: exportado para el diagnóstico de Ajustes. */
export type DeviceProfileRecord = HardwareSignals & {
  tier: DeviceTier;
  /** ms del micro-benchmark (null = aún no corrido o falló). */
  benchMs: number | null;
  /** Epoch ms del registro. */
  ts: number;
  /** De dónde salió el tier: "cache" | "signals" | "bench". */
  source: "cache" | "signals" | "bench";
};

/** Telemetría expuesta en window.__deviceProfile (forma EXACTA de la spec). */
export type DeviceProfileTelemetry = {
  tier: DeviceTier;
  cores: number | null;
  memoryGB: number | null;
  ua: string;
  dpr: number;
  touch: number;
  benchMs: number | null;
  ts: number;
};

const STORAGE_KEY = "scannerlab.deviceProfile.v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const IDLE_FALLBACK_MS = 1500;

let initialized = false;
let current: DeviceProfileRecord | null = null;

/* ── UA: plataforma + versión mayor ─────────────────────────────────────── */

function parseUa(ua: string): { platform: HardwareSignals["platform"]; osMajor: number | null } {
  // iOS: "…iPhone OS 17_2…" / "…CPU like Mac OS X 13…" (iPad antiguo).
  const ios = /(?:iPhone|iPad|iPod)/i.test(ua);
  if (ios) {
    const m = /OS\s+(\d+)[._]/i.exec(ua);
    return { platform: "ios", osMajor: m ? Number(m[1]) : null };
  }
  const android = /Android/i.test(ua);
  if (android) {
    const m = /Android\s+(\d+)/i.exec(ua);
    return { platform: "android", osMajor: m ? Number(m[1]) : null };
  }
  return { platform: "otro", osMajor: null };
}

/* ── Tier ───────────────────────────────────────────────────────────────── */

/**
 * bajo: cores ≤4 O memoria ≤2 GB O bench >8 ms
 * medio: cores ≤6 O bench 3–8 ms
 * alto: el resto.
 * En iOS (sin deviceMemory, cores ocultos/clamped) el BENCHMARK manda.
 */
function computeTier(s: {
  cores: number | null;
  memoryGB: number | null;
  benchMs: number | null;
  platform: HardwareSignals["platform"];
}): DeviceTier {
  const { cores, memoryGB, benchMs, platform } = s;
  if (platform === "ios") {
    // Benchmark manda; sin benchmark cae a la heurística de cores.
    if (benchMs !== null) {
      if (benchMs > 8) return "bajo";
      if (benchMs > 3) return "medio";
      return "alto";
    }
    if (cores !== null && cores <= 4) return "bajo";
    if (cores !== null && cores <= 6) return "medio";
    return "alto";
  }
  if (
    (cores !== null && cores <= 4) ||
    (memoryGB !== null && memoryGB <= 2) ||
    (benchMs !== null && benchMs > 8)
  ) {
    return "bajo";
  }
  if ((cores !== null && cores <= 6) || (benchMs !== null && benchMs > 3)) {
    return "medio";
  }
  return "alto";
}

/* ── Lectura de señales ─────────────────────────────────────────────────── */

/** Señales crudas, síncronas, a prueba de SSR/navegadores viejos. */
export function readDeviceProfile(): HardwareSignals {
  const nav =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { deviceMemory?: number })
      : null;
  const ua = nav ? nav.userAgent : "";
  const { platform, osMajor } = parseUa(ua);
  const mm =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia
      : null;
  return {
    cores:
      nav && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    memoryGB:
      nav && typeof nav.deviceMemory === "number" && nav.deviceMemory > 0
        ? nav.deviceMemory
        : null,
    ua,
    platform,
    osMajor,
    dpr: typeof window !== "undefined" && typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1,
    touch: nav && typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0,
    secure: typeof window !== "undefined" ? window.isSecureContext === true : false,
    reducedMotion: mm ? mm("(prefers-reduced-motion: reduce)").matches : false,
    coarsePointer: mm ? mm("(pointer: coarse)").matches : false,
  };
}

/* ── Micro-benchmark (decode+draw 256 px) ───────────────────────────────── */

/**
 * Canvas 256×256 con contenido → PNG data URL → decodificar con <img> →
 * dibujar de vuelta al canvas. Mide el coste real de decode+draw en ms.
 * try/catch silencioso: si falla, el tier cae a las señales estáticas.
 */
async function runBench(): Promise<number | null> {
  try {
    const N = 256;
    const canvas = document.createElement("canvas");
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createLinearGradient(0, 0, N, N);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#000000");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, N, N);
    ctx.fillStyle = "#808080";
    for (let i = 0; i < 200; i += 1) {
      ctx.fillRect((i * 37) % N, (i * 53) % N, 3, 3);
    }
    const url = canvas.toDataURL("image/png");
    const t0 = performance.now();
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0);
          resolve();
        } catch {
          reject(new Error("drawImage falló"));
        }
      };
      img.onerror = () => reject(new Error("decode falló"));
      img.src = url;
    });
    const ms = performance.now() - t0;
    return ms >= 0 && Number.isFinite(ms) ? Math.round(ms * 10) / 10 : null;
  } catch {
    return null; // silencioso por spec
  }
}

/* ── Persistencia (TTL 24 h) ────────────────────────────────────────────── */

function readCache(): DeviceProfileRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceProfileRecord>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ts !== "number" ||
      (parsed.tier !== "bajo" && parsed.tier !== "medio" && parsed.tier !== "alto")
    ) {
      return null;
    }
    if (Date.now() - parsed.ts > TTL_MS) return null; // caducado
    return {
      cores: typeof parsed.cores === "number" ? parsed.cores : null,
      memoryGB: typeof parsed.memoryGB === "number" ? parsed.memoryGB : null,
      ua: typeof parsed.ua === "string" ? parsed.ua : "",
      platform: parsed.platform === "ios" || parsed.platform === "android" ? parsed.platform : "otro",
      osMajor: typeof parsed.osMajor === "number" ? parsed.osMajor : null,
      dpr: typeof parsed.dpr === "number" ? parsed.dpr : 1,
      touch: typeof parsed.touch === "number" ? parsed.touch : 0,
      secure: parsed.secure === true,
      reducedMotion: parsed.reducedMotion === true,
      coarsePointer: parsed.coarsePointer === true,
      tier: parsed.tier,
      benchMs: typeof parsed.benchMs === "number" ? parsed.benchMs : null,
      ts: parsed.ts,
      source: "cache",
    };
  } catch {
    return null;
  }
}

function persist(rec: DeviceProfileRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* privada/SSR/cuota: el perfil vive solo en memoria */
  }
}

/* ── Exposición ─────────────────────────────────────────────────────────── */

function expose(rec: DeviceProfileRecord): void {
  try {
    const w = window as unknown as { __deviceProfile?: DeviceProfileTelemetry };
    w.__deviceProfile = {
      tier: rec.tier,
      cores: rec.cores,
      memoryGB: rec.memoryGB,
      ua: rec.ua,
      dpr: rec.dpr,
      touch: rec.touch,
      benchMs: rec.benchMs,
      ts: rec.ts,
    };
  } catch {
    /* SSR o window sellado: no pasa nada */
  }
}

/* ── Init (idempotente) ─────────────────────────────────────────────────── */

/**
 * Instala el perfil: caché → exposición inmediata → micro-benchmark en idle
 * (una vez por sesión) → re-tier + persistencia. Llamado al importar el
 * módulo (vía crash-reporter) — NADIE más necesita llamarlo.
 */
export function initDeviceProfile(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const cached = readCache();
  if (cached) {
    current = cached;
    expose(current);
    // Señales vivas refrescan los campos volátiles (dpr/matchMedia cambian
    // con el zoom/la config del usuario) sin re-corre el benchmark.
    const fresh = readDeviceProfile();
    current = { ...cached, dpr: fresh.dpr, reducedMotion: fresh.reducedMotion, coarsePointer: fresh.coarsePointer };
    expose(current);
  } else {
    const signals = readDeviceProfile();
    current = {
      ...signals,
      tier: computeTier({
        cores: signals.cores,
        memoryGB: signals.memoryGB,
        benchMs: null,
        platform: signals.platform,
      }),
      benchMs: null,
      ts: Date.now(),
      source: "signals",
    };
    expose(current);
    persist(current);
  }

  // Micro-benchmark una vez por sesión, en idle (fallback 1500 ms).
  const bench = () => {
    void (async () => {
      const benchMs = await runBench();
      if (benchMs === null || !current) return; // falló → tier de señales queda
      const rec: DeviceProfileRecord = {
        ...current,
        benchMs,
        tier: computeTier({ cores: current.cores, memoryGB: current.memoryGB, benchMs, platform: current.platform }),
        ts: Date.now(),
        source: "bench",
      };
      current = rec;
      persist(rec);
      expose(rec);
    })();
  };
  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(bench, { timeout: 3000 });
  } else {
    window.setTimeout(bench, IDLE_FALLBACK_MS);
  }
}

/** Perfil actual (null antes de init o en SSR). */
export function getDeviceProfile(): DeviceProfileRecord | null {
  return current;
}

// Auto-init perezoso al importar (crash-reporter importa este módulo desde
// page.tsx a nivel de módulo → corre ANTES del primer render, sin tocar
// page.tsx ni ninguna zona v12).
initDeviceProfile();
