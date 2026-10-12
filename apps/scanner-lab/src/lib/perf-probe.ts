/**
 * Sonda de rendimiento §6 — PLAN A (memoria y render).
 *
 * ⚠️ OBLIGATORIA e IDÉNTICA al Plan B: la comparabilidad entre planes es el
 * requisito más importante del encargo. NO personalizar la API.
 *
 * Contrato exacto (§6):
 *   window.__perfProbe = {
 *     marks: [],                    // {ev, ts, meta}
 *     mark(ev, meta?)               // capture_fired | page_saved{bytes,pxLong} | editor_open |
 *                                   // editor_first_render | filter_applied{ms} | save_done{ms,bytes} |
 *                                   // export_start/export_end{type:pdf|zip|png, ms, bytes}
 *     memory()                      // {heapMB, limitMB, ts} de performance.memory (si existe)
 *     longTasks                     // PerformanceObserver('longtask'): count + totalMs
 *     fpsSample(ms=3000)            // medición de FPS durante interacción (pan/zoom editor)
 *     report()                      // JSON resumen imprimible (console.table)
 *   }
 *
 * - 100% local, sin red. Envuelta en try/catch para no romper producción.
 * - Instrumenta los eventos listados SIN tocar lógica de negocio.
 * - El módulo se auto-instala al importarse (page.tsx la importa tras el
 *   crash-reporter). Los módulos de scanner-core marcan eventos leyendo
 *   window.__perfProbe directamente (core no puede importar código de la
 *   app): el global ES el contrato.
 */

/** Entrada de la cola de eventos: {ev, ts, meta}. */
export interface PerfMark {
  ev: string;
  ts: number;
  meta?: Record<string, number | string | boolean>;
}

/** Lectura de memoria: {heapMB, limitMB, ts} (performance.memory si existe). */
export interface PerfMemory {
  heapMB: number;
  limitMB: number;
  ts: number;
}

/** Agregado de long tasks observadas desde la instalación. */
export interface PerfLongTasks {
  count: number;
  totalMs: number;
}

/** Muestra de FPS durante una ventana de interacción. */
export interface PerfFpsSample {
  fps: number;
  frames: number;
  ms: number;
}

/** Resumen imprimible de report(). */
export interface PerfReport {
  generatedAt: number;
  marks: PerfMark[];
  markCounts: Record<string, number>;
  memory: PerfMemory | null;
  longTasks: PerfLongTasks;
  lastEvents: PerfMark[];
  totals: {
    pagesSaved: number;
    savedBytes: number;
    saveMs: number;
    exportMs: number;
    exportBytes: number;
    filterMs: number;
  };
}

/** API pública expuesta en window.__perfProbe (§6 — exacta). */
export interface PerfProbe {
  marks: PerfMark[];
  mark(ev: string, meta?: Record<string, number | string | boolean>): void;
  memory(): PerfMemory | null;
  longTasks: PerfLongTasks;
  fpsSample(ms?: number): Promise<PerfFpsSample>;
  report(): PerfReport;
}

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
}

const MAX_MARKS = 512;

/** Marca un evento de forma SEGURA (nunca rompe producción). */
export function markPerf(ev: string, meta?: Record<string, number | string | boolean>): void {
  try {
    (window as unknown as { __perfProbe?: PerfProbe }).__perfProbe?.mark(ev, meta);
  } catch {
    /* sonda best-effort */
  }
}

/** Instala la sonda en window (idempotente). 100% local, sin red. */
export function installPerfProbe(): PerfProbe {
  if (typeof window === "undefined") return null as unknown as PerfProbe;
  const existing = (window as unknown as { __perfProbe?: PerfProbe }).__perfProbe;
  if (existing) return existing;

  const marks: PerfMark[] = [];
  const longTasks: PerfLongTasks = { count: 0, totalMs: 0 };

  // Long tasks: PerformanceObserver('longtask') → count + totalMs.
  try {
    if (typeof PerformanceObserver !== "undefined") {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.count += 1;
          longTasks.totalMs += entry.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    }
  } catch {
    /* navegador sin longtask (Safari viejo): la sonda sigue viva */
  }

  const probe: PerfProbe = {
    marks,
    mark(ev, meta) {
      try {
        marks.push({ ev, ts: Date.now(), ...(meta ? { meta } : {}) });
        if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
      } catch {
        /* noop */
      }
    },
    memory() {
      try {
        const perf = performance as MemoryPerformance;
        const m = perf.memory;
        if (!m || !m.usedJSHeapSize) return null;
        return {
          heapMB: Math.round((m.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
          limitMB: Math.round((m.jsHeapSizeLimit / (1024 * 1024)) * 10) / 10,
          ts: Date.now(),
        };
      } catch {
        return null;
      }
    },
    longTasks,
    async fpsSample(ms = 3000) {
      return new Promise<PerfFpsSample>((resolve) => {
        try {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames += 1;
            const elapsed = performance.now() - start;
            if (elapsed >= ms) {
              resolve({ fps: Math.round((frames / elapsed) * 1000), frames, ms: Math.round(elapsed) });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        } catch {
          resolve({ fps: 0, frames: 0, ms: 0 });
        }
      });
    },
    report() {
      const markCounts: Record<string, number> = {};
      let pagesSaved = 0;
      let savedBytes = 0;
      let saveMs = 0;
      let exportMs = 0;
      let exportBytes = 0;
      let filterMs = 0;
      try {
        for (const m of marks) {
          markCounts[m.ev] = (markCounts[m.ev] ?? 0) + 1;
          const meta = m.meta;
          if (!meta) continue;
          if (m.ev === "page_saved") {
            pagesSaved += 1;
            savedBytes += Number(meta.bytes ?? 0);
          } else if (m.ev === "save_done") {
            saveMs += Number(meta.ms ?? 0);
            savedBytes += Number(meta.bytes ?? 0);
          } else if (m.ev === "export_end") {
            exportMs += Number(meta.ms ?? 0);
            exportBytes += Number(meta.bytes ?? 0);
          } else if (m.ev === "filter_applied") {
            filterMs += Number(meta.ms ?? 0);
          }
        }
      } catch {
        /* resumen best-effort */
      }
      return {
        generatedAt: Date.now(),
        marks,
        markCounts,
        memory: probe.memory(),
        longTasks,
        lastEvents: marks.slice(-12),
        totals: { pagesSaved, savedBytes, saveMs, exportMs, exportBytes, filterMs },
      };
    },
  };

  try {
    (window as unknown as { __perfProbe?: PerfProbe }).__perfProbe = probe;
  } catch {
    /* noop */
  }
  return probe;
}

// Auto-instalación al importar (idempotente, try/catch).
try {
  installPerfProbe();
} catch {
  /* sonda best-effort */
}
