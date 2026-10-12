/**
 * PLAN B (B1) — Detector de capacidades MODERNAS del dispositivo.
 *
 * Hipótesis del plan: WebCodecs (ImageDecoder) + WebGPU permiten decodificar
 * y procesar imágenes grandes sin el muro de memoria del canvas 2D, y en
 * dispositivos capaces (opt-in) capturar por encima de 4032 px para bajar por
 * supersampling al export estándar.
 *
 * REGLAS DE ESTE MÓDULO:
 *  · TODO es feature-detected y se cachea POR SESIÓN.
 *  · NUNCA lanza: ante cualquier fallo devuelve capacidades VACÍAS → la app
 *    se comporta IDÉNTICA a main (filosofía de seguridad del plan, §1).
 *  · Sin red, sin telemetría externa: `window.__techCaps` es 100 % local.
 *  · NO toca la lógica de sensor-profiler (regla 4): solo CONSUME su tipo
 *    `SensorProfile` (import type — borrado en runtime, cero dependencia).
 *
 * Además vive aquí (sin tocar store.ts/page-store — territorio del Plan A):
 *  · El TOGGLE experimental «Captura alta resolución (beta)» (localStorage).
 *  · El registro del último SensorProfile (lo publica CameraView al sondear)
 *    para que Ajustes pueda evaluar la visibilidad del toggle (B4).
 *  · `buildHiResPhotoSettings` — photoSettings hasta 6000 px con la MISMA
 *    lógica de rangos min/max/step de buildCappedPhotoSettings (capas de
 *    defensa intactas; solo cambia el objetivo del pick).
 */

import type { SensorProfile, SensorSettingRange } from "./sensor-profiler";

// ─── Tipos mínimos estructurales (cero dependencias npm nuevas — regla 9) ──

/** navigator.gpu (estructura mínima consumida por este plan). */
interface GpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<unknown>;
  getPreferredCanvasFormat?(): string;
}

/** Capacidades detectadas (inmutables tras el sondeo). */
export interface TechCapabilities {
  /** WebCodecs ImageDecoder (decodificación fuera del hilo principal). */
  imageDecoder: boolean;
  /** WebGPU: navigator.gpu presente Y requestAdapter() exitoso. */
  webgpu: boolean;
  /** navigator.deviceMemory (GB, Chrome; máx. reportado 8). null = no expuesto. */
  deviceMemory: number | null;
  /** navigator.hardwareConcurrency. null = no expuesto. */
  hardwareConcurrency: number | null;
  /** OffscreenCanvas disponible DENTRO de un worker (sondeo con blob worker). */
  offscreenCanvasInWorker: boolean | null;
  /** iPhone/iPad o Safari de escritorio (en ellos el toggle NO existe — B4). */
  isIOSOrSafari: boolean;
  checkedAt: number;
}

/** Capacidades VACÍAS = dispositivo sin APIs modernas = comportamiento main. */
export const EMPTY_TECH_CAPABILITIES: TechCapabilities = {
  imageDecoder: false,
  webgpu: false,
  deviceMemory: null,
  hardwareConcurrency: null,
  offscreenCanvasInWorker: null,
  isIOSOrSafari: false,
  checkedAt: 0,
};

/** Tope experimental del lado mayor de CAPTURA (B4: 6000). */
export const EXPERIMENTAL_CAPTURE_CAP = 6000;

/** localStorage del toggle (NO vive en el store: arquitectura intacta). */
export const HI_RES_TOGGLE_KEY = "scannerlab-hi-res-beta";

/** Flag QA de caps vacías (B5 — demostración de no-regresión). */
export const QA_EMPTY_CAPS_FLAG = "scannerlab-qa-empty-tech-caps";

// ─── Estado de sesión ────────────────────────────────────────────────────────

let capsPromise: Promise<TechCapabilities> | null = null;
let capsCache: TechCapabilities | null = null;

/** Adapter WebGPU compartido (B1 lo detecta; B3 lo consume — una sola sirena). */
let sharedAdapter: unknown | null | undefined;

/** Último perfil de sensor registrado por CameraView (sesión, no persistido). */
let lastSensorProfile: SensorProfile | null = null;

/** Telemetría del último supersampling hi-res (QA local). */
let lastHiResTelemetry: Record<string, unknown> | null = null;

// ─── Detección (B1) ──────────────────────────────────────────────────────────

function qaWantsEmptyCaps(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { __qaEmptyTechCaps?: boolean };
    if (w.__qaEmptyTechCaps === true) return true;
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(QA_EMPTY_CAPS_FLAG) === "1";
    }
  } catch {
    /* privada: tratar como sin flag */
  }
  return false;
}

/** B5 — ¿el flag QA de caps vacías está activo? Las rutas modernas (B2/B3)
 *  lo consultan para garantizarse APAGADAS: con el flag, la app es idéntica
 *  a main (demostración de no-regresión, documentada en el PR). */
export function qaEmptyCapsForced(): boolean {
  return qaWantsEmptyCaps();
}

/** Carrera con timeout para sondas que pueden colgarse. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      p.then(done, () => done(fallback));
    } catch {
      done(fallback);
    }
    window.setTimeout(() => done(fallback), ms);
  });
}

/** ¿iPhone/iPad o Safari (cualquiera)? En ellos el toggle NO existe (B4). */
function detectIOSOrSafari(): boolean {
  try {
    const nav = navigator;
    const ua = nav.userAgent ?? "";
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
    const isSafari = /^((?!Chrom|CriOS|Edg|EdgiOS|Fxi|FxiOS|OPR|Samsung).)*Safari\//i.test(ua);
    return isIOS || isSafari;
  } catch {
    return false;
  }
}

/** OffscreenCanvas DENTRO de un worker (sondeo con worker de blob, 2 s). */
function probeOffscreenCanvasInWorker(): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      if (typeof Worker === "undefined" || typeof Blob === "undefined") {
        resolve(null);
        return;
      }
      const src = `self.onmessage=()=>{try{postMessage(typeof OffscreenCanvas!=="undefined")}catch(e){postMessage(false)}}`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const w = new Worker(url);
      let settled = false;
      const done = (v: boolean | null) => {
        if (settled) return;
        settled = true;
        try {
          w.terminate();
        } catch {
          /* ya muerto */
        }
        URL.revokeObjectURL(url);
        resolve(v);
      };
      w.onmessage = (ev: MessageEvent) => done(ev.data === true);
      w.onerror = () => done(null);
      window.setTimeout(() => done(null), 2000);
      w.postMessage(0);
    } catch {
      resolve(null);
    }
  });
}

/** requestAdapter() con carrera corta (un adapter colgado no bloquea la app). */
async function probeWebgpuAdapter(): Promise<unknown | null> {
  try {
    if (typeof navigator === "undefined") return null;
    const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") return null;
    const adapter = await withTimeout<unknown>(
      Promise.resolve(gpu.requestAdapter()),
      3000,
      null
    );
    return adapter ?? null;
  } catch {
    return null;
  }
}

/**
 * Sonda de capacidades (cacheada por sesión). NUNCA rechaza: ante cualquier
 * fallo devuelve EMPTY_TECH_CAPABILITIES → la app es idéntica a main.
 */
export function getTechCapabilities(): Promise<TechCapabilities> {
  if (capsPromise) return capsPromise;
  capsPromise = (async (): Promise<TechCapabilities> => {
    // B5 — flag QA: caps vacías forzadas (demostración de no-regresión).
    if (qaWantsEmptyCaps()) {
      capsCache = { ...EMPTY_TECH_CAPABILITIES, checkedAt: Date.now() };
      return capsCache;
    }
    // QA — override de caps (solo consola; permite probar la UI del toggle
    // en entornos sin las APIs reales — documentado en docs/plan-b).
    try {
      const w = window as unknown as { __qaTechCapsOverride?: TechCapabilities };
      if (w.__qaTechCapsOverride && typeof w.__qaTechCapsOverride === "object") {
        capsCache = { ...EMPTY_TECH_CAPABILITIES, ...w.__qaTechCapsOverride };
        return capsCache;
      }
    } catch {
      /* sin window */
    }

    const caps: TechCapabilities = {
      imageDecoder: false,
      webgpu: false,
      deviceMemory: null,
      hardwareConcurrency: null,
      offscreenCanvasInWorker: null,
      isIOSOrSafari: detectIOSOrSafari(),
      checkedAt: Date.now(),
    };
    try {
      caps.imageDecoder =
        typeof window !== "undefined" &&
        typeof (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder === "function";
    } catch {
      caps.imageDecoder = false;
    }
    try {
      const nav = navigator as unknown as {
        deviceMemory?: number;
        hardwareConcurrency?: number;
      };
      caps.deviceMemory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
      caps.hardwareConcurrency =
        typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;
    } catch {
      /* sin navigator */
    }
    // WebGPU + adapter (compartido con B3 — una única sirena por sesión).
    sharedAdapter = await probeWebgpuAdapter();
    caps.webgpu = sharedAdapter != null;
    // OffscreenCanvas en worker (informativo — no bloquea nada).
    caps.offscreenCanvasInWorker = await probeOffscreenCanvasInWorker();
    capsCache = caps;
    return caps;
  })().catch(() => {
    capsCache = { ...EMPTY_TECH_CAPABILITIES, checkedAt: Date.now() };
    return capsCache;
  });
  return capsPromise;
}

/** Caps ya sondeadas (null si aún no resolvió — el llamador decide). */
export function peekTechCapabilities(): TechCapabilities | null {
  return capsCache;
}

/** Adapter WebGPU cacheado (B3). undefined = aún no sondeado. */
export function peekSharedGpuAdapter(): unknown | null | undefined {
  return sharedAdapter;
}

/** Re-sondeo manual (QA). */
export async function refreshTechCapabilities(): Promise<TechCapabilities> {
  capsPromise = null;
  capsCache = null;
  sharedAdapter = undefined;
  return getTechCapabilities();
}

// ─── Toggle experimental (B4) — localStorage, sin tocar el store ────────────

export function isHiResToggleOn(): boolean {
  try {
    return localStorage.getItem(HI_RES_TOGGLE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHiResToggle(on: boolean): void {
  try {
    if (on) localStorage.setItem(HI_RES_TOGGLE_KEY, "1");
    else localStorage.removeItem(HI_RES_TOGGLE_KEY);
  } catch {
    /* privada: el toggle vive solo en memoria de la sesión */
  }
}

// ─── Registro del sensor (B4) — consume el SensorProfile de CameraView ──────

/** CameraView publica aquí el perfil sondeado (una vez por apertura). */
export function registerSensorProfile(profile: SensorProfile | null): void {
  lastSensorProfile = profile;
}

export function getRegisteredSensorProfile(): SensorProfile | null {
  return lastSensorProfile;
}

/**
 * B4 — ¿Se cumplen TODAS las condiciones para el modo «Captura alta
 * resolución (beta)»? (visibilidad del toggle Y activación real):
 *   ImageDecoder && WebGPU(adapter) && deviceMemory ≥ 8 &&
 *   sensorProfile.nativeLongSide > 4032 && NO iPhone/Safari.
 */
export function isHiResCandidate(
  caps: TechCapabilities,
  profile: SensorProfile
): boolean {
  if (!caps.imageDecoder) return false;
  if (!caps.webgpu) return false;
  if (caps.deviceMemory === null || caps.deviceMemory < 8) return false;
  if (caps.isIOSOrSafari) return false;
  const native = profile.nativeLongSide;
  if (typeof native !== "number" || native <= profile.safeCapPx) return false;
  return true;
}

/**
 * ¿El modo hi-res está ACTIVO ahora mismo? (toggle ON + todas las condiciones
 * de B4 re-evaluadas EN VIVO contra caps y perfil registrados). Conservador:
 * ante cualquier duda → false = comportamiento main.
 */
export function isHiResCaptureActive(): boolean {
  try {
    if (!isHiResToggleOn()) return false;
    const caps = capsCache;
    if (!caps) return false;
    const profile = lastSensorProfile;
    if (!profile) return false;
    return isHiResCandidate(caps, profile);
  } catch {
    return false;
  }
}

// ─── photoSettings hi-res (B4) — pick de rangos idéntico al sensor-profiler ──

/**
 * photoSettings para takePhoto() que piden al ISP una foto hasta
 * EXPERIMENTAL_CAPTURE_CAP (6000) de lado mayor, conservando el aspecto
 * nativo. MISMA lógica de min/max/step de buildCappedPhotoSettings (las capas
 * de defensa de sensor-profiler quedan INTACTAS — aquí solo cambia el
 * objetivo). Devuelve undefined si no aplica (sensor ≤ tope estándar, rangos
 * no ajustables o el pick no recortaría nada) → takePhoto a secas.
 */
export function buildHiResPhotoSettings(profile: SensorProfile): PhotoSettings | undefined {
  if (!profile.photoSettingsAdjustable) return undefined;
  if (!profile.nativeW || !profile.nativeH) return undefined;
  if ((profile.nativeLongSide ?? 0) <= profile.safeCapPx) return undefined;

  const pick = (
    range: SensorSettingRange | null,
    native: number,
    target: number
  ): number | undefined => {
    if (!range || native <= 0) return undefined;
    const { min, max, step } = range;
    if (max <= min) return undefined;
    let v = Math.min(target, max);
    v = Math.max(v, min);
    if (step > 1) v = Math.round(v / step) * step;
    v = Math.min(v, max);
    if (v >= native) return undefined; // no aporta nada → no tocar
    return v;
  };

  const w = pick(profile.wRange, profile.nativeW, EXPERIMENTAL_CAPTURE_CAP);
  const hTarget = Math.round(
    (EXPERIMENTAL_CAPTURE_CAP * profile.nativeH) / profile.nativeW
  );
  const h = pick(profile.hRange, profile.nativeH, hTarget);
  const settings: PhotoSettings = {};
  if (w) settings.imageWidth = w;
  if (h) settings.imageHeight = h;
  if (!settings.imageWidth && !settings.imageHeight) return undefined;
  return settings;
}

/** Telemetría del supersampling (la escribe webcodecs-decode). */
export function setHiResTelemetry(t: Record<string, unknown>): void {
  lastHiResTelemetry = t;
}

// ─── Sonda de QA (patrón __sensorTools/__scannerPrecision) ─────────────────

declare global {
  interface Window {
    /** Capacidades modernas detectadas (B1) — solo lectura para QA. */
    __techCaps?: TechCapabilities | null;
    /** Herramientas QA del PLAN B (bench/supersample/exif los añaden sus módulos). */
    __techTools?: Record<string, unknown>;
  }
}

if (typeof window !== "undefined") {
  try {
    Object.defineProperty(window, "__techCaps", {
      configurable: true,
      get: () => capsCache,
    });
    const w = window as unknown as { __techTools?: Record<string, unknown> };
    w.__techTools = {
      ...(w.__techTools ?? {}),
      caps: () => capsCache,
      refresh: () => refreshTechCapabilities(),
      candidate: () => {
        const p = lastSensorProfile;
        return capsCache && p ? isHiResCandidate(capsCache, p) : null;
      },
      toggle: () => {
        try {
          return localStorage.getItem(HI_RES_TOGGLE_KEY) === "1";
        } catch {
          return false;
        }
      },
      setToggleQA: (v: boolean) => setHiResToggle(v),
      /** QA ONLY: simula un perfil de sensor para probar la UI del toggle. */
      setSensorProfileQA: (p: Partial<SensorProfile> | null) => {
        lastSensorProfile = p as SensorProfile | null;
      },
      lastHiRes: () => lastHiResTelemetry,
    };
  } catch {
    /* sin window (SSR): nada que exponer */
  }
}
