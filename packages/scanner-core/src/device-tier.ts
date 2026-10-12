/**
 * ADDENDUM Plan A (A5) — Tier-2: calidad adaptativa por gama.
 *
 * Regla reformulada (addendum §2, reemplaza a la regla 2 del plan original):
 *   «4032 es el techo y el default. 3200 es el piso técnico de gama baja,
 *    aplicado SOLO como downscale post-captura del resultado YA recortado —
 *    JAMÁS como recorte del sensor ni restricción de photoSettings.»
 *
 * Por qué esto NO es el bug v6.3: allí el 3200 era tope de CAPTURA (el ISP
 * recortaba contenido del sensor). Aquí se captura SIEMPRE el sensor
 * completo (CameraView/sensor-profiler ⛔ intocables, diff 0) y el 3200
 * decide el tamaño del RESULTADO procesado (recorte + filtro ya aplicados):
 * contenido íntegro, solo menos píxeles. La matemática que lo justifica:
 * A4 a 300 DPI = 3508px; 3200 ≈ 274 DPI — el downscale hacia pantallas de
 * 1080–1440px esconde ruido/JPEG. Ahorro de memoria por buffer: ~30.7 MB
 * vs ~48.8 MB (−37%).
 *
 * Resolución (A5a, síncrona al arrancar — orden de precedencia):
 *   1. QA override: localStorage["scannerlab-qa-force-tier"] =
 *      "low" | "high" | "auto" (ausente = auto). Un forzado explícito
 *      low/high es ABSOLUTO (no participa del fallback por timing): es el
 *      conmutador de contraste del dueño (§6.3 del addendum) y debe ser
 *      determinista. "auto" = resolución automática completa.
 *   2. navigator.deviceMemory definido: <= TIER_LOW_MEMORY_GB → low;
 *      si no → high (método "memory").
 *   3. deviceMemory indefinido (iOS Safari, Firefox): arranca high (método
 *      "default"); el timing puede degradar (A5b).
 *
 * Fallback por timing (A5b — solo degrada, JAMÁS sube): tras cada guardado,
 * durante las primeras 3 capturas de la sesión, si >= 2 superan
 * TIER_SAVE_TIME_MS el tier pasa a low por el resto de la sesión
 * (sessionStorage["scannerlab-tier-session"]). Sin oscilación: una vez
 * degradado no se revierte. Se aplica a capturas NUEVAS; las páginas ya
 * guardadas no se migran (documentos mixtos 4032+3200: pdf-export y
 * thumbnails ya manejan dimensiones por página).
 *
 * Estado por sesión (stateless): nada persiste entre sesiones —
 * deviceMemory es estable y el timing se re-evalúa gratis en cada sesión.
 * La única persistencia es (a) la key QA del dueño (localStorage, explícita
 * en el addendum) y (b) la marca de degradación en sessionStorage (muere
 * con la pestaña — «el resto de la SESIÓN»).
 *
 * SSR-safe: sin window/localStorage/navigator (prerender de Next.js) todo
 * cae al método "default" (high) sin romper nada.
 */

import { PROCESSED_MAX_LONG_SIDE } from "./image-processor";

/** Tier del dispositivo: high = 4032 (default), low = 3200 (piso de gama). */
export type DeviceTier = "high" | "low";

/** Método/origen del tier vigente (el "timing" solo aparece tras degradar). */
export type TierMethod = "qa-forced" | "memory" | "default" | "timing";

/** Piso técnico de gama baja (validado visualmente por el dueño, c225fbe). */
export const TIER_LOW_LONG_SIDE = 3200;

/** navigator.deviceMemory <= 4 GB → low (constante afinable). */
export const TIER_LOW_MEMORY_GB = 4;

/** Umbral del fallback por timing en ms (constante afinable). */
export const TIER_SAVE_TIME_MS = 3000;

/** Ventana del fallback: solo las primeras 3 capturas de la sesión. */
const TIMING_WINDOW_CAPTURES = 3;

/** Disparo del fallback: >= 2 guardados lentos dentro de la ventana. */
const TIMING_TRIGGER_SLOW = 2;

/** localStorage (QA del dueño, §A5a.1 — explícita en el addendum). */
const QA_FORCE_KEY = "scannerlab-qa-force-tier";

/** sessionStorage (degradación por timing — «el resto de la sesión», §A5b). */
const SESSION_KEY = "scannerlab-tier-session";

/** Vista de la sonda: window.__perfProbe.tier() / __tierTools.info(). */
export interface TierInfo {
  memoryGB: number | null;
  tier: DeviceTier;
  effectiveLongSide: number;
  method: TierMethod;
  downgradedByTiming: boolean;
}

interface TierState {
  /** Tier vigente (puede haber caído a low por timing). */
  tier: DeviceTier;
  /** Método del tier VIGENTE ("timing" tras degradar). */
  method: TierMethod;
  /** Método de la resolución INICIAL pura (sin la degradación por timing). */
  initialMethod: "qa-forced" | "memory" | "default";
  /** navigator.deviceMemory en GB (null si el navegador no lo define). */
  memoryGB: number | null;
  /** true si el fallback por timing degradó la sesión. */
  downgradedByTiming: boolean;
  /** Muestras de timing de la ventana (primeras capturas de la sesión). */
  samples: number[];
  /** Ventana consumida o tier ya decidido → deja de recolectar. */
  frozen: boolean;
}

let state: TierState | null = null;

/** Lee el override de QA ("low" | "high" | "auto"; ausente/inválido = null). */
function readQaForce(): "low" | "high" | "auto" | null {
  try {
    const v = globalThis.localStorage?.getItem(QA_FORCE_KEY);
    if (v === "low" || v === "high" || v === "auto") return v;
  } catch {
    /* localStorage bloqueado (privacidad/SSR) → resolución automática */
  }
  return null;
}

/** navigator.deviceMemory en GB (null si no está definido). */
function readDeviceMemoryGB(): number | null {
  try {
    const nav = globalThis.navigator as
      | (Navigator & { deviceMemory?: unknown })
      | undefined;
    if (nav && typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory)) {
      return nav.deviceMemory;
    }
  } catch {
    /* sin navigator (SSR) → default */
  }
  return null;
}

/** ¿La sesión (pestaña) ya fue degradada por timing? */
function sessionDowngraded(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_KEY) === "low";
  } catch {
    return false;
  }
}

/** Marca la sesión como degradada (vive solo en sessionStorage). */
function markSessionDowngraded(): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_KEY, "low");
  } catch {
    /* sin sessionStorage: la degradación vive solo en memoria este arranque */
  }
}

/** Resolución perezosa e idempotente (la primera llamada la congela). */
function resolve(): TierState {
  if (state) return state;

  const forced = readQaForce();
  const memoryGB = readDeviceMemoryGB();

  let tier: DeviceTier;
  let initialMethod: TierState["initialMethod"];
  if (forced === "low" || forced === "high") {
    // A5a.1 — override de QA: ABSOLUTO (contraste determinista §6.3).
    tier = forced;
    initialMethod = "qa-forced";
  } else if (memoryGB !== null) {
    // A5a.2 — heurística de memoria (deviceMemory es estable).
    tier = memoryGB <= TIER_LOW_MEMORY_GB ? "low" : "high";
    initialMethod = "memory";
  } else {
    // A5a.3 — sin deviceMemory (iOS Safari, Firefox): high por defecto;
    // el timing puede degradar.
    tier = "high";
    initialMethod = "default";
  }

  let method: TierMethod = initialMethod;
  let downgradedByTiming = false;
  // A5b — restauración de la degradación de ESTA sesión (solo degrada,
  // jamás sube; el QA forzado explícito no participa del timing).
  if (initialMethod !== "qa-forced" && tier === "high" && sessionDowngraded()) {
    tier = "low";
    method = "timing";
    downgradedByTiming = true;
  }

  state = {
    tier,
    method,
    initialMethod,
    memoryGB,
    downgradedByTiming,
    samples: [],
    frozen: downgradedByTiming,
  };
  return state;
}

/** A5a — resolución inicial (síncrona; el método "timing" nunca aparece
 *  aquí: es la resolución de ARRANQUE pura, la degradación se ve en
 *  tierInfo()/sonda). Idempotente: la primera llamada congela el estado. */
export function resolveInitialTier(): {
  tier: DeviceTier;
  method: "qa-forced" | "memory" | "default";
  memoryGB: number | null;
} {
  const s = resolve();
  return { tier: s.tier, method: s.initialMethod, memoryGB: s.memoryGB };
}

/** Lado mayor EFECTIVO del resultado procesado: 4032 (high) | 3200 (low).
 *  Es el valor que los call sites de producción pasan a
 *  processImageToBlob — el techo/default 4032 (PROCESSED_MAX_LONG_SIDE)
 *  SIGUE existiendo en image-processor (addendum §2). */
export function effectiveProcessedLongSide(): number {
  const s = resolve();
  return s.tier === "low" ? TIER_LOW_LONG_SIDE : PROCESSED_MAX_LONG_SIDE;
}

/** A5b — alimenta el fallback por timing con la duración de un guardado
 *  (ms por página procesada). Solo degrada (high→low), jamás sube; sin
 *  oscilación: una vez degradado, por el resto de la sesión. La medición
 *  la alimenta store.ts en los marks de la sonda ya existentes
 *  (capture_fired → page_saved: la sonda §6 NO cambia — marks
 *  byte-compatibles ⛔ addendum §3.5). */
export function reportTimingSample(saveMs: number): void {
  const s = resolve();
  if (s.frozen) return;
  // Ya low (por memoria): nada que degradar — ventana cerrada.
  if (s.tier === "low") {
    s.frozen = true;
    return;
  }
  if (s.samples.length >= TIMING_WINDOW_CAPTURES) {
    s.frozen = true;
    return;
  }
  s.samples.push(saveMs);
  const slow = s.samples.filter((ms) => ms >= TIER_SAVE_TIME_MS).length;
  if (slow >= TIMING_TRIGGER_SLOW) {
    s.tier = "low";
    s.method = "timing";
    s.downgradedByTiming = true;
    s.frozen = true;
    markSessionDowngraded();
  }
}

/** Vista completa para la sonda (§A7): window.__perfProbe.tier() y
 *  window.__tierTools.info() — { memoryGB, tier, effectiveLongSide,
 *  method, downgradedByTiming }. */
export function tierInfo(): TierInfo {
  const s = resolve();
  return {
    memoryGB: s.memoryGB,
    tier: s.tier,
    effectiveLongSide: effectiveProcessedLongSide(),
    method: s.method,
    downgradedByTiming: s.downgradedByTiming,
  };
}

/** Escribe el override de QA (lo consume __tierTools.force, §A7). */
export function writeQaForceTier(value: "low" | "high" | "auto"): void {
  try {
    globalThis.localStorage?.setItem(QA_FORCE_KEY, value);
  } catch {
    /* best-effort: la QA del dueño es local */
  }
}
