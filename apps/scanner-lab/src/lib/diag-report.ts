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
  type DiagDeviceSnapshot,
  type DiagBenchResults,
} from "./device-profile";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

/** Build que originó este informe (rama @ commit corto). */
export const DIAG_BUILD = "diag/informe-dispositivo @ d8043ff";

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
  version: 1;
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
    };
    pages: {
      count: number;
      resolutions: number[];
      captureToSavedMs: number[];
      medianMs: number | null;
    };
    editor: {
      openMs: number | null;
      firstRenderMs: number | null;
      fpsAuto: number | null;
      filterMedianMs: number | null;
      filterCount: number;
      sessionMs: number | null;
    };
    ocr: {
      count: number;
      firstColdMs: number | null;
      medianWarmMs: number | null;
      charsTotal: number;
    };
    exports: Array<{ type: string; ms: number; bytes: number }>;
    memory: { peakHeapMB: number | null };
    longTasks: { count: number; totalMs: number };
  };
  settings: { ocrEnabled: boolean };
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
  let firstRenderMs: number | null = null;
  for (const fr of marksOf("editor_first_render")) {
    let prevOpen: PerfProbeMark | null = null;
    for (const e of editorOpens) {
      if (e.ts <= fr.ts) prevOpen = e;
    }
    if (prevOpen) firstRenderMs = Math.max(0, fr.ts - prevOpen.ts);
  }

  // Cámara: ready (última sesión) + FPS early/late.
  const cameraReady = marksOf("camera_ready");
  let fpsEarly: number | null = null;
  let fpsLate: number | null = null;
  for (const m of marksOf("fps_camera")) {
    if (m.meta?.phase === "early" && typeof m.meta.fps === "number") fpsEarly = m.meta.fps;
    if (m.meta?.phase === "late" && typeof m.meta.fps === "number") fpsLate = m.meta.fps;
  }

  // Filtros: mediana de ms + contador.
  const filterMs = marksOf("filter_applied")
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const filterCount = marksOf("filter_applied").length;

  // OCR: 1ª (frío, incluye CDN del motor) vs mediana del resto (tibio).
  const ocrDones = marksOf("ocr_done");
  const ocrMs = ocrDones
    .map((m) => metaNum(m, "ms"))
    .filter((v): v is number => v !== null);
  const charsTotal = ocrDones.reduce((n, m) => n + (metaNum(m, "chars") ?? 0), 0);

  // Exports completados.
  const exports = marksOf("export_end")
    .map((m) => ({
      type: typeof m.meta?.type === "string" ? (m.meta.type as string) : "?",
      ms: metaNum(m, "ms") ?? 0,
      bytes: metaNum(m, "bytes") ?? 0,
    }))
    .filter((e) => e.ms > 0);

  const lastClose = marksOf("editor_close");
  const bootMark = marksOf("boot_ready")[0];

  let ocrEnabled = false;
  try {
    ocrEnabled = useScannerStore.getState().settings.ocrEnabled === true;
  } catch {
    /* store no disponible: queda false */
  }

  return {
    format: "scannerlab-diag-report",
    version: 1,
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
      },
      pages: {
        count: savedPages.length,
        resolutions: savedPages
          .map((m) => metaNum(m, "pxLong"))
          .filter((v): v is number => v !== null),
        captureToSavedMs,
        medianMs: median(captureToSavedMs),
      },
      editor: {
        openMs: editorOpenMs,
        firstRenderMs,
        fpsAuto: metaNum(marksOf("fps_auto").pop(), "fps"),
        filterMedianMs: median(filterMs),
        filterCount,
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
      },
    },
    settings: { ocrEnabled },
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
  push("Formato  : diag-report v1");
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
  push(`Edad de la medición : ${b.benchAgeDays ?? 0} días`);
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
  const resolutions =
    s.pages.resolutions.length > 0 ? s.pages.resolutions.join(", ") + " px" : DASH;
  push(`Páginas capturadas        : ${s.pages.count} · guardadas a ${resolutions}`);
  const savedList =
    s.pages.captureToSavedMs.length > 0
      ? s.pages.captureToSavedMs.slice(0, 8).map((v) => Math.round(v)).join(" · ") +
        (s.pages.captureToSavedMs.length > 8 ? " · …" : "")
      : DASH;
  push(`Captura → guardada (ms)   : ${savedList} (mediana ${s.pages.medianMs ?? DASH})`);
  push(`Editor: apertura/render   : ${s.editor.openMs !== null ? `${s.editor.openMs} ms` : DASH} / ${fmtMs(s.editor.firstRenderMs)}`);
  push(`FPS pan/zoom (auto)       : ${s.editor.fpsAuto ?? DASH}`);
  push(`Filtros aplicados         : ${s.editor.filterCount} · mediana ${fmtMs(s.editor.filterMedianMs)}`);
  push(
    `OCR                       : ${s.ocr.count} págs · 1ª ${fmtMs(s.ocr.firstColdMs)} (frío) · tibio ${fmtMs(s.ocr.medianWarmMs)} · ${s.ocr.charsTotal} chars`
  );
  const exportsTxt =
    s.exports.length > 0
      ? s.exports.map((e) => `${e.type} ${fmtMs(e.ms)} (${fmtMB(e.bytes)})`).join(" · ")
      : DASH;
  push(`Exports                   : ${exportsTxt}`);
  push(`Heap pico (JS)            : ${s.memory.peakHeapMB !== null ? `${s.memory.peakHeapMB} MB` : DASH}`);
  push(`Long tasks                : ${s.longTasks.count} tareas >50 ms · total ${fmtMs(s.longTasks.totalMs)}`);
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
