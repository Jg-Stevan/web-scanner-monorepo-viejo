"use client";

/**
 * DIAG — diag-report: ensambla el INFORME DE DIAGNÓSTICO con datos 100 %
 * reales medidos en el dispositivo (sonda §6 + device-profile §4) y lo
 * expone como JSON (análisis) y TXT (compartible por WhatsApp).
 *
 * Privacidad estricta (⛔ spec): el informe NO contiene imágenes, contenido
 * de documentos, nombres de documentos ni texto OCR. Solo métricas,
 * dimensiones y tamaños. Jamás referencia blobs, data URLs ni ocrText.
 *
 * Export y compartir (§7): window.__diagTools = { snapshot(), bench(),
 * report(), txt(), download(), share(), copy() }. Sin red: todo local.
 */

import { perfProbe, PERF_PROBE_T0, PERF_PROBE_T0_AT, type PerfProbeMark } from "./perf-probe";
import {
  getDeviceSnapshot,
  runBenchmarks,
  getBenchCache,
  getPeakHeapMB,
  readBattery,
  type DiagDeviceSnapshot,
  type DiagBenchResults,
} from "./device-profile";
import { getQaTestState, type QaStepLog } from "./qa-standard-test";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

/** Build que originó este informe (rama @ commit corto). */
export const DIAG_BUILD = "diag/v1.1-sub-marks (fingerprint pendiente)";

/** Sección QA del informe (v3 — spec diag-test-estandar-qa): solo viaja
 *  cuando el guión corrió (o se abortó a mitad). */
export interface DiagQaSection {
  standard: true;
  script: "qa-standard-v1.1";
  steps: Array<{
    id: string;
    label: string;
    ms: number | null;
    ok: boolean;
    mode?: "auto" | "manual";
    waitMs?: number | null;
  }>;
  aborted?: boolean;
}

/* ------------------------------------------------------------------ */
/* Tipos del informe (spec §6a)                                         */
/* ------------------------------------------------------------------ */

export interface DiagTier {
  tier: string | null;
  effectiveLongSide: number | null;
  method: string | null;
  downgradedByTiming: boolean;
  qaForced: boolean;
}

export interface DiagReport {
  format: "scannerlab-diag-report";
  /** v1 → v2 (sub-marks) → v3 (test estándar QA): SOLO campos
   *  adicionales — todo campo v1 conserva nombre y significado (informes
   *  de los lotes 1-2 comparables 1:1). */
  version: 3;
  generatedAt: string;
  app: { build: string };
  device: DiagDeviceSnapshot;
  tier: DiagTier | null;
  benchmarks: DiagBenchResults & { benchAgeDays: number | null };
  session: {
    startedAt: string;
    durationMs: number;
    boot: { appReadyMs: number | null };
    camera: {
      readyMs: number | null;
      fpsEarly: number | null;
      fpsLate: number | null;
      /** v3 — espera del auto-shutter por página (capture_fired −
       *  capture_stable): el dato que cuantifica la demora del shutter en
       *  gama baja, con o sin guión QA. */
      autoShutterWaitMs: number[];
    };
    pages: {
      count: number;
      resolutions: number[];
      captureToSavedMs: number[];
      medianMs: number | null;
      /** v1.1 — descomposición de captura→guardada (medianas):
       *  shot→processed (decode+downscale+calidad) y processed→write
       *  (persistencia en el store). */
      segments: {
        shotToProcessedMs: number | null;
        processedToWriteMs: number | null;
      };
    };
    editor: {
      openMs: number | null;
      firstRenderMs: number | null;
      /** v1.1 — primer render POR APERTURA (índice = openIndex−1, cap 5;
       *  null = apertura sin render medido). Si la 2ª cae <1.5 s, el costo
       *  de la 1ª es chunk-red/compile → solución de bundle, no pipeline). */
      firstRenders: Array<number | null>;
      fpsAuto: number | null;
      filterMedianMs: number | null;
      filterCount: number;
      /** v1.1 — mediana de filtros POR filterId (¿cuál es el caro?). */
      filters: Array<{ filterId: string; count: number; medianMs: number }>;
      sessionMs: number | null;
    };
    ocr: {
      count: number;
      firstColdMs: number | null;
      medianWarmMs: number | null;
      charsTotal: number;
    };
    /** v1.1 — exports con páginas y lado largo de la fuente. */
    exports: Array<{
      type: string;
      ms: number;
      bytes: number;
      pages: number | null;
      pxLong: number | null;
    }>;
    memory: { peakHeapMB: number | null };
    longTasks: { count: number; totalMs: number; supported: boolean };
  };
  settings: { ocrEnabled: boolean };
  /** v3 — presente SOLO si el test estándar QA corrió en esta sesión. */
  qa?: DiagQaSection;
}

/* ------------------------------------------------------------------ */
/* Utilidades sobre los marks de la sonda                               */
/* ------------------------------------------------------------------ */

function marksOf(ev: string): PerfProbeMark[] {
  try {
    return perfProbe.marks.filter((m) => m.ev === ev);
  } catch {
    return [];
  }
}

function metaNum(m: PerfProbeMark | undefined, key: string): number | null {
  const v = m?.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Marca más reciente con ts ≤ límite (para aparear tramos secuenciales). */
function lastBefore(marks: PerfProbeMark[], ts: number): PerfProbeMark | null {
  let found: PerfProbeMark | null = null;
  for (const m of marks) {
    if (m.ts <= ts) found = m;
    else break;
  }
  return found;
}

/** Feature-check del tier-2: en main el módulo device-tier NO existe.
 *  Cuando plan-a se rebase sobre esta rama, su sonda expone tier() y
 *  __tierTools → el campo se enciende SOLO (spec §1.9). */
function resolveTier(): DiagTier | null {
  try {
    const w = window as unknown as {
      __tierTools?: { info?: () => Record<string, unknown> | null };
      __perfProbe?: { tier?: () => Record<string, unknown> | null };
    };
    const raw = w.__tierTools?.info?.() ?? w.__perfProbe?.tier?.();
    if (!raw) return null;
    const method = typeof raw.method === "string" ? raw.method : null;
    return {
      tier: typeof raw.tier === "string" ? raw.tier : null,
      effectiveLongSide:
        typeof raw.effectiveLongSide === "number" ? raw.effectiveLongSide : null,
      method,
      downgradedByTiming: raw.downgradedByTiming === true,
      qaForced: method === "qa-forced",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Ensamblado del informe                                               */
/* ------------------------------------------------------------------ */

/** Construye el informe completo (JSON §6a) con los datos medidos. */
export async function buildDiagReport(): Promise<DiagReport> {
  const [device, benchmarks] = await Promise.all([
    getDeviceSnapshot(),
    runBenchmarks(false), // usa la caché de 7 días si está fresca
  ]);
  const cache = getBenchCache();
  const benchAgeDays = cache
    ? Math.round(((Date.now() - cache.ts) / 86_400_000) * 10) / 10
    : 0;

  // ── Marks de la sesión ──
  const savedPages = marksOf("page_saved");
  const firedShots = marksOf("capture_fired");
  const editorOpens = marksOf("editor_open");

  // Captura → página guardada (disparo → aterrizaje en la sesión).
  const captureToSavedMs: number[] = [];
  for (const p of savedPages) {
    let lastFired: PerfProbeMark | null = null;
    for (const f of firedShots) {
      if (f.ts <= p.ts) lastFired = f;
    }
    if (lastFired) captureToSavedMs.push(Math.max(0, p.ts - lastFired.ts));
  }

  // Captura → editor (editor_open.ts − page_saved.ts — spec §5, la última).
  let editorOpenMs: number | null = null;
  for (const p of savedPages) {
    const next = editorOpens.find((e) => e.ts >= p.ts);
    if (next) editorOpenMs = Math.max(0, next.ts - p.ts);
  }

  // Primer render del editor (editor_first_render − editor_open previo).
  // Se prefiere el ÚLTIMO render con trabajo real (no cacheado): el
  // cacheado es instantáneo por construcción y escondería el costo real.
  let firstRenderMs: number | null = null;
  let firstRenderCached: number | null = null;
  for (const fr of marksOf("editor_first_render")) {
    let prevOpen: PerfProbeMark | null = null;
    for (const e of editorOpens) {
      if (e.ts <= fr.ts) prevOpen = e;
    }
    if (!prevOpen) continue;
    const delta = Math.max(0, fr.ts - prevOpen.ts);
    if (fr.meta?.cached === false) firstRenderMs = delta;
    firstRenderCached = delta;
  }
  if (firstRenderMs === null) firstRenderMs = firstRenderCached;

  // v1.1 — firstRender POR APERTURA: cada editor_first_render se asigna a
  // la apertura numerada que lo precede (openIndex del editor_open previo;
  // si la marca vieja no trae openIndex, se deriva contando aperturas).
  const firstRenders: Array<number | null> = [];
  for (const fr of marksOf("editor_first_render")) {
    let prevOpen: PerfProbeMark | null = null;
    let opensBefore = 0;
    for (const e of editorOpens) {
      if (e.ts <= fr.ts) {
        prevOpen = e;
        opensBefore += 1;
      }
    }
    if (!prevOpen) continue;
    const openIndex = metaNum(prevOpen, "openIndex") ?? opensBefore;
    if (openIndex < 1) continue;
    const delta = Math.max(0, fr.ts - prevOpen.ts);
    while (firstRenders.length < openIndex) firstRenders.push(null);
    firstRenders[openIndex - 1] = delta;
  }
  if (firstRenders.length > 5) firstRenders.length = 5; // cap 5 (spec)

  // Cámara: ready (última sesión) + FPS early/late. v3 — esperas del
  // auto-shutter: cada capture_fired apareado con el capture_stable más
  // cercano ANTES del disparo (estable→disparo).
  const cameraReady = marksOf("camera_ready");
  let fpsEarly: number | null = null;
  let fpsLate: number | null = null;
  for (const m of marksOf("fps_camera")) {
    if (m.meta?.phase === "early" && typeof m.meta.fps === "number") fpsEarly = m.meta.fps;
    if (m.meta?.phase === "late" && typeof m.meta.fps === "number") fpsLate = m.meta.fps;
  }
  const autoShutterWaitMs: number[] = [];
  for (const f of firedShots) {
    const stable = lastBefore(marksOf("capture_stable"), f.ts);
    if (stable) autoShutterWaitMs.push(Math.max(0, f.ts - stable.ts));
  }

  // Filtros: mediana de ms + contador. v1.1 — ADEMÁS por filterId (el mark
  // viejo sin id cae en "?" — comparable con lotes 1-2).
  const filterMs = marksOf("filter_applied")
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const filterCount = marksOf("filter_applied").length;
  const filtersById = new Map<string, number[]>();
  for (const m of marksOf("filter_applied")) {
    const id =
      typeof m.meta?.filterId === "string"
        ? (m.meta.filterId as string)
        : typeof m.meta?.filter === "string"
          ? (m.meta.filter as string)
          : "?";
    const ms = metaNum(m, "ms");
    if (ms === null) continue;
    const arr = filtersById.get(id) ?? [];
    arr.push(ms);
    filtersById.set(id, arr);
  }
  const filtersByFilterId = [...filtersById.entries()]
    .map(([filterId, arr]) => ({
      filterId,
      count: arr.length,
      medianMs: median(arr) ?? 0,
    }))
    .sort((a, b) => b.medianMs - a.medianMs);

  // OCR: 1ª (frío, incluye CDN del motor) vs mediana del resto (tibio).
  const ocrDones = marksOf("ocr_done");
  const ocrMs = ocrDones
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const charsTotal = ocrDones.reduce((n, m) => n + (metaNum(m, "chars") ?? 0), 0);

  // Exports completados. v1.1 — con páginas y lado largo de la fuente.
  const exports = marksOf("export_end")
    .map((m) => ({
      type: typeof m.meta?.type === "string" ? (m.meta.type as string) : "?",
      ms: metaNum(m, "ms") ?? 0,
      bytes: metaNum(m, "bytes") ?? 0,
      pages: metaNum(m, "pages"),
      pxLong: metaNum(m, "pxLong"),
    }))
    .filter((e) => e.ms > 0);

  // v1.1 — tramos de captura: shot→processed (procesado) y
  // processed→write (escritura), medianas de la sesión.
  const shotToProcessedMs: number[] = [];
  const processedToWriteMs: number[] = [];
  const shotMarks = marksOf("capture_shot");
  const processedMarks = marksOf("capture_processed");
  const writeMarks = marksOf("capture_write");
  for (const p of processedMarks) {
    const shot = lastBefore(shotMarks, p.ts);
    if (shot) shotToProcessedMs.push(Math.max(0, p.ts - shot.ts));
    const write = writeMarks.find((w) => w.ts >= p.ts);
    if (write) processedToWriteMs.push(Math.max(0, write.ts - p.ts));
  }

  const lastClose = marksOf("editor_close");
  const bootMark = marksOf("boot_ready")[0];

  let ocrEnabled = false;
  try {
    ocrEnabled = useScannerStore.getState().settings.ocrEnabled === true;
  } catch {
    /* store no disponible: queda false */
  }

  // v1.1 — batería FRESCA al momento del informe (el snapshot cacheado la
  // leyó al arrancar; nivel+enchufe ayudan a interpretar fpsEarly bajos).
  const freshBattery = await readBattery();
  if (freshBattery) device.battery = freshBattery;

  // v3 — sección QA: SOLO si el guión corrió (log no vacío o abortado).
  const qaState = getQaTestState();
  const qaRan = qaState.log.length > 0 || qaState.aborted;
  const qa: DiagQaSection | undefined = qaRan
    ? {
        standard: true,
        script: "qa-standard-v1.1",
        steps: qaState.log.map((l: QaStepLog) => ({
          id: l.id,
          label: l.label,
          ms: l.ms,
          ok: l.ok,
          ...(l.mode !== undefined ? { mode: l.mode } : {}),
          ...(l.waitMs !== undefined ? { waitMs: l.waitMs } : {}),
        })),
        ...(qaState.aborted ? { aborted: true } : {}),
      }
    : undefined;

  return {
    format: "scannerlab-diag-report",
    version: 3,
    generatedAt: new Date().toISOString(),
    app: { build: DIAG_BUILD },
    device,
    tier: resolveTier(),
    benchmarks: { ...benchmarks, benchAgeDays },
    session: {
      startedAt: new Date(PERF_PROBE_T0_AT).toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - PERF_PROBE_T0)),
      boot: { appReadyMs: metaNum(bootMark, "ms") },
      camera: {
        readyMs: metaNum(cameraReady[cameraReady.length - 1], "ms"),
        fpsEarly,
        fpsLate,
        autoShutterWaitMs,
      },
      pages: {
        count: savedPages.length,
        resolutions: savedPages
          .map((m) => metaNum(m, "pxLong"))
          .filter((v): v is number => v !== null),
        captureToSavedMs,
        medianMs: median(captureToSavedMs),
        segments: {
          shotToProcessedMs: median(shotToProcessedMs),
          processedToWriteMs: median(processedToWriteMs),
        },
      },
      editor: {
        openMs: editorOpenMs,
        firstRenderMs,
        firstRenders,
        fpsAuto: metaNum(marksOf("fps_auto").pop(), "fps"),
        filterMedianMs: median(filterMs),
        filterCount,
        filters: filtersByFilterId,
        sessionMs: metaNum(lastClose[lastClose.length - 1], "durationMs"),
      },
      ocr: {
        count: ocrDones.length,
        firstColdMs: ocrMs.length > 0 ? (ocrMs[0] as number) : null,
        medianWarmMs: ocrMs.length > 1 ? median(ocrMs.slice(1)) : null,
        charsTotal,
      },
      exports,
      memory: { peakHeapMB: getPeakHeapMB() },
      longTasks: {
        count: perfProbe.longTasks.count,
        totalMs: Math.round(perfProbe.longTasks.totalMs),
        supported: perfProbe.longTasks.supported,
      },
    },
    settings: { ocrEnabled },
    ...(qa ? { qa } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* TXT compartible (spec §6b — plantilla exacta)                        */
/* ------------------------------------------------------------------ */

/** "—" para datos que el navegador no expone. Jamás inventar valores. */
const DASH = "—";

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function fmtMB(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1_048_576;
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

/** Construye el TXT del informe (plantilla §6b). */
export function buildDiagTxt(r: DiagReport): string {
  const d = r.device;
  const b = r.benchmarks;
  const s = r.session;
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push("==============================================");
  push(" INFORME DE DIAGNÓSTICO · scanner-lab");
  push("==============================================");
  push(`Generado : ${new Date(r.generatedAt).toLocaleString()}`);
  push(`Build    : ${r.app.build}`);
  push("Formato  : diag-report v3");
  if (r.qa) {
    push();
    push("TEST ESTÁNDAR v1.1" + (r.qa.aborted ? " (ABORTADO — informe parcial)" : ""));
    push("Protocolo: ahorro batería OFF · dispositivo");
    push("frío · captura automática nativa · mismo");
    push("documento con texto");
  }
  push();
  push("-- DISPOSITIVO -------------------------------");
  push(`Modelo       : ${d.model ?? DASH}`);
  push(`SO           : ${[d.os, d.osVersion].filter(Boolean).join(" ") || DASH}`);
  push(`Navegador    : ${[d.browser, d.browserVersion].filter(Boolean).join(" ") || DASH}`);
  push(`CPU          : ${d.cores ?? DASH} núcleos · bench: ${b.cpuBenchMs ?? DASH} ms (menor = más rápido)`);
  push(`RAM          : ${d.ramGB ?? DASH} GB reportados · heap límite: ${d.heapLimitMB ?? DASH} MB`);
  push(`GPU          : ${d.gpuRenderer ?? DASH} · maxTexture ${d.maxTextureSize ?? DASH}`);
  push(`Pantalla     : ${d.screen.w || DASH}×${d.screen.h || DASH} · dpr ${d.screen.dpr || DASH} · refresh medido ${d.screen.refreshHz ?? DASH} Hz`);
  push(
    `Almacenam.   : ${d.storage?.usageMB ?? DASH} usados / ${d.storage?.quotaMB ?? DASH} cuota`
  );
  push(
    `Batería      : ${d.battery ? `${d.battery.level}% · ${d.battery.charging ? "cargando" : "descargando"}` : DASH} · ahorro datos: ${d.network?.saveData ?? DASH}`
  );
  push(
    `Red          : ${d.network?.effectiveType ?? DASH} · ~${d.network?.downlink ?? DASH} Mb/s · rtt ${d.network?.rtt ?? DASH} ms`
  );
  push();
  push("-- BENCHMARKS (medidos, no teóricos) ---------");
  push(`Downscale 4032→2048 : ${b.canvasDownscale2048Ms ?? DASH}   (operación clave del editor)`);
  push(`Downscale 4032→3200 : ${b.canvasDownscale3200Ms ?? DASH}   (operación clave del tier low)`);
  push(`JPEG encode 3200 q0.92 : ${b.jpegEncodeMs ?? DASH}`);
  push(`Decode 3200 → bitmap : ${b.decodeMs ?? DASH}`);
  push(`Canvas máx verificado : ${b.maxCanvasPx ?? DASH} px`);
  push();
  push("-- TIER ACTIVO -------------------------------");
  if (r.tier) {
    push(`Tier        : ${r.tier.tier ?? DASH} · lado efectivo: ${r.tier.effectiveLongSide ?? DASH} px`);
    push(`Método      : ${r.tier.method ?? DASH} · degradado por timing: ${r.tier.downgradedByTiming ? "sí" : "no"}`);
  } else {
    push(`Tier        : ${DASH} (no disponible en esta build)`);
  }
  push();
  push(`-- SESIÓN (iniciada ${new Date(PERF_PROBE_T0_AT).toLocaleTimeString()} · ${fmtDur(s.durationMs)}) -----`);
  push(`Arranque app → lista      : ${fmtMs(s.boot.appReadyMs)}`);
  push(`Cámara: abrir → lista     : ${fmtMs(s.camera.readyMs)}`);
  push(`FPS cámara                : ${s.camera.fpsEarly ?? DASH} · tarde: ${s.camera.fpsLate ?? DASH}`);
  // v3 — espera del auto-shutter (estable→disparo) por página + modo del
  // guión (auto/manual/mixto — solo cuando el test QA corrió).
  if (s.camera.autoShutterWaitMs.length > 0) {
    const waits = s.camera.autoShutterWaitMs
      .slice(0, 5)
      .map((v) => `${(v / 1000).toFixed(1)} s`)
      .join(" · ");
    const med = median(s.camera.autoShutterWaitMs);
    const qaCaptures = (r.qa?.steps ?? []).filter((st) => st.mode !== undefined);
    const mode =
      qaCaptures.length === 0
        ? ""
        : qaCaptures.every((st) => st.mode === "auto")
          ? " · modo auto"
          : qaCaptures.every((st) => st.mode === "manual")
            ? " · modo manual"
            : " · modo mixto";
    push(
      `Shutter auto (estable→disparo): ${waits} (mediana ${med !== null ? `${(med / 1000).toFixed(1)} s` : DASH})${mode}`
    );
  }
  const resolutions =
    s.pages.resolutions.length > 0 ? s.pages.resolutions.join(", ") + " px" : DASH;
  push(`Páginas capturadas        : ${s.pages.count} · guardadas a ${resolutions}`);
  const savedList =
    s.pages.captureToSavedMs.length > 0
      ? s.pages.captureToSavedMs.slice(0, 8).map((v) => Math.round(v)).join(" · ") +
        (s.pages.captureToSavedMs.length > 8 ? " · …" : "")
      : DASH;
  push(`Captura → guardada (ms)   : ${savedList} (mediana ${s.pages.medianMs ?? DASH})`);
  push(`  tramos: procesado ${fmtMs(s.pages.segments.shotToProcessedMs)} · escritura ${fmtMs(s.pages.segments.processedToWriteMs)} (medianas)`);
  const renders2 = s.editor.firstRenders[1];
  push(
    `Editor: apertura/render   : ${s.editor.openMs !== null ? `${s.editor.openMs} ms` : DASH} / ${fmtMs(s.editor.firstRenderMs)}${renders2 !== null && renders2 !== undefined ? ` · 2ª: ${fmtMs(renders2)}` : ""}`
  );
  push(`FPS pan/zoom (auto)       : ${s.editor.fpsAuto ?? DASH}`);
  push(`Filtros aplicados         : ${s.editor.filterCount} · mediana ${fmtMs(s.editor.filterMedianMs)}`);
  const topFilter = s.editor.filters[0];
  if (topFilter) {
    push(`Filtro más caro           : ${topFilter.filterId} · ${fmtMs(topFilter.medianMs)} mediana (${topFilter.count})`);
  }
  push(
    `OCR                       : ${s.ocr.count} págs · 1ª ${fmtMs(s.ocr.firstColdMs)} (frío) · tibio ${fmtMs(s.ocr.medianWarmMs)} · ${s.ocr.charsTotal} chars`
  );
  const exportsTxt =
    s.exports.length > 0
      ? s.exports.map((e) => `${e.type} ${fmtMs(e.ms)} (${fmtMB(e.bytes)})`).join(" · ")
      : DASH;
  push(`Exports                   : ${exportsTxt}`);
  push(`Heap pico (JS)            : ${s.memory.peakHeapMB !== null ? `${s.memory.peakHeapMB} MB` : DASH}`);
  push(
    s.longTasks.supported
      ? `Long tasks                : ${s.longTasks.count} tareas >50 ms · total ${fmtMs(s.longTasks.totalMs)}`
      : "Long tasks                : no soportado en este navegador"
  );
  push();
  push("-- PRIVACIDAD ---------------------------------");
  push("Este informe NO contiene imágenes, contenido de");
  push("documentos ni texto OCR. Solo métricas.");
  push("==============================================");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* __diagTools (§7) — export, compartir, copiar                         */
/* ------------------------------------------------------------------ */

/** Nombre base del archivo: scannerlab-diag-{modelo}-{YYYYMMDD-HHmm}. */
function diagFileBase(model: string | null | undefined, ext: string): string {
  const clean = (model ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `scannerlab-diag-${clean || "dispositivo"}-${stamp}.${ext}`;
}

function downloadTextFile(text: string, name: string, type: string): void {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  } catch {
    /* el llamador informa */
  }
}

export interface DiagTools {
  snapshot(): Promise<DiagDeviceSnapshot | null>;
  bench(force?: boolean): Promise<DiagBenchResults | null>;
  report(): Promise<DiagReport>;
  txt(): Promise<string>;
  download(): Promise<void>;
  share(): Promise<"shared" | "downloaded" | "cancelled" | "failed">;
  copy(): Promise<boolean>;
}

export const diagTools: DiagTools = {
  async snapshot() {
    try {
      return await getDeviceSnapshot();
    } catch {
      return null;
    }
  },
  async bench(force = false) {
    try {
      return await runBenchmarks(force);
    } catch {
      return null;
    }
  },
  async report() {
    return buildDiagReport();
  },
  async txt() {
    return buildDiagTxt(await buildDiagReport());
  },
  async download() {
    const report = await buildDiagReport();
    downloadTextFile(
      JSON.stringify(report, null, 2),
      diagFileBase(report.device.model, "json"),
      "application/json"
    );
  },
  async share() {
    try {
      const text = await buildDiagTxt(await buildDiagReport());
      const name = diagFileBase(
        (await getDeviceSnapshot()).model,
        "txt"
      );
      const file = new File([text], name, { type: "text/plain" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "Informe de diagnóstico · scanner-lab" });
        return "shared";
      }
      // Sin Web Share (o sin soporte de archivos) → descarga el TXT para
      // adjuntarlo a mano (WhatsApp web/gallery) + el toast lo explica.
      downloadTextFile(text, name, "text/plain");
      return "downloaded";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "cancelled";
      // Último recurso: al menos que el informe no se pierda.
      try {
        const text = await buildDiagTxt(await buildDiagReport());
        downloadTextFile(text, diagFileBase(null, "txt"), "text/plain");
      } catch {
        /* nada más que hacer */
      }
      return "failed";
    }
  },
  async copy() {
    try {
      const text = await buildDiagTxt(await buildDiagReport());
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
};

declare global {
  interface Window {
    __diagTools?: DiagTools;
  }
}

if (typeof window !== "undefined") {
  try {
    window.__diagTools = diagTools;
  } catch {
    /* best-effort */
  }
}
