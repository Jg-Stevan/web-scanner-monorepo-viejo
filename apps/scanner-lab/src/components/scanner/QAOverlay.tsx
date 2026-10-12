"use client";

/**
 * QA — Overlay del Test estándar v1.1 (spec diag-test-estandar-qa).
 *
 * Panel PERMANENTE y legible en claro/oscuro (vidrio oscuro sobre cualquier
 * vista) con: checklist por paso (pendiente / en curso / ✓ con ms), tiempo
 * acumulado, banner del paso (sostén / reencuadra / fallback manual) y
 * Abortar SIEMPRE disponible. No bloquea la app: solo el panel captura
 * eventos; el resto es pointer-events-none.
 *
 * Estados:
 *  · armado + cámara  → botón destacado «Iniciar test (3 páginas)» (paso 0:
 *    el dueño encuadra y dispara — decisión 2026-10-12).
 *  · corriendo        → checklist + banner + abortar (+ «sigue trabajando…»
 *    en pasos pesados; nunca aborta solo por timeout).
 *  · terminado        → tarjeta final: resumen, compartir informe (con
 *    reintento real por gesto) y cerrar.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  QA_STEPS,
  qaStandardTest,
  useQaTestStore,
} from "@/lib/qa-standard-test";
import { useScannerStore } from "@jg-stevan/scanner-core/store";

function fmtSec(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function QAOverlay() {
  const view = useScannerStore((s) => s.view);
  const armed = useQaTestStore((s) => s.armed);
  const running = useQaTestStore((s) => s.running);
  const finished = useQaTestStore((s) => s.finished);
  const aborted = useQaTestStore((s) => s.aborted);
  const step = useQaTestStore((s) => s.step);
  const log = useQaTestStore((s) => s.log);
  const hint = useQaTestStore((s) => s.hint);
  const manualPrompt = useQaTestStore((s) => s.manualPrompt);
  const slow = useQaTestStore((s) => s.slow);
  const startedAt = useQaTestStore((s) => s.startedAt);
  const shareResult = useQaTestStore((s) => s.shareResult);

  // Reloj del tiempo acumulado (solo mientras corre — re-render por segundo).
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running || startedAt === null) return;
    const update = () => setElapsedMs(performance.now() - startedAt);
    update();
    const t = window.setInterval(update, 1000);
    return () => window.clearInterval(t);
  }, [running, startedAt]);

  // Paso «report»: intentar compartir YA (con fallback a descarga); el
  // botón del panel queda para reintentar con gesto real del usuario.
  const reportTriedRef = useRef(false);
  useEffect(() => {
    if (running && step === "report" && !reportTriedRef.current) {
      reportTriedRef.current = true;
      void qaStandardTest.runReportShare();
    }
    if (step !== "report") reportTriedRef.current = false;
  }, [running, step]);

  // ── Nada que pintar ──
  if (!armed && !running && !finished) return null;
  if (armed && !running && !finished && view !== "camera") return null;

  // ── Paso 0: cámara armada → botón destacado «Iniciar test» ──
  if (armed && !running && !finished) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[118px] z-30 flex flex-col items-center gap-2 px-6">
        <button
          type="button"
          data-qa-start
          onClick={() => qaStandardTest.start()}
          className="pointer-events-auto flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-[#007aff] px-7 text-[16px] font-semibold text-white shadow-[0_8px_28px_rgba(0,122,255,0.55)] transition-transform active:scale-[0.97]"
        >
          <CircleDashed className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
          Iniciar test (3 páginas)
        </button>
        <p className="max-w-[300px] rounded-2xl bg-black/70 px-3.5 py-2 text-center text-[12px] leading-snug text-white/85 backdrop-blur-sm">
          Encuadra una página con texto legible y pulsa. El resto corre solo
          (capturas automáticas → editor → filtros → OCR → PDF).
        </p>
      </div>
    );
  }

  // ── Tarjeta final ──
  if (!running && finished) {
    const okCount = log.filter((l) => l.ok).length;
    return (
      <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 px-6 backdrop-blur-[2px]">
        <div
          role="dialog"
          aria-label={aborted ? "Test abortado" : "Test completado"}
          className="w-full max-w-[330px] rounded-3xl bg-[#1c1c1e] p-5 text-white shadow-2xl ring-1 ring-white/10"
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            {aborted ? (
              <X className="h-9 w-9 text-[#ff9f0a]" strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-9 w-9 text-[#34c759]" strokeWidth={2.2} aria-hidden="true" />
            )}
            <h2 className="text-[18px] font-semibold tracking-tight">
              {aborted ? "Test abortado" : "Test estándar completado"}
            </h2>
            <p className="text-[12.5px] leading-snug text-white/60">
              {aborted
                ? `Informe parcial: ${okCount} de ${QA_STEPS.length} pasos. Sigue compartible.`
                : `${QA_STEPS.length} pasos · guiño qa-standard-v1.1 en el informe.`}
            </p>
          </div>

          <div className="my-3.5 max-h-44 overflow-y-auto rounded-2xl bg-black/40 p-1 [scrollbar-width:thin]">
            <ul className="flex flex-col gap-0.5">
              {log.map((l, i) => (
                <li
                  key={`${l.id}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-[12.5px]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {l.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34c759]" aria-hidden="true" />
                    ) : (
                      <X className="h-3.5 w-3.5 shrink-0 text-[#ff453a]" aria-hidden="true" />
                    )}
                    <span className="truncate text-white/85">{l.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/55">
                    {l.ok
                      ? `${fmtSec(l.ms)}${l.mode ? ` · ${l.mode}` : ""}${
                          l.waitMs != null ? ` (espera ${fmtSec(l.waitMs)})` : ""
                        }`
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-qa-share
              onClick={() => void qaStandardTest.shareAgain()}
              className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-[#007aff] text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
            >
              <Share2 className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
              Compartir informe
            </button>
            <button
              type="button"
              data-qa-dismiss
              onClick={() => qaStandardTest.dismiss()}
              className="flex min-h-[40px] w-full items-center justify-center rounded-2xl bg-white/10 text-[14px] font-medium text-white/80 ring-1 ring-inset ring-white/10 transition-transform active:scale-[0.98]"
            >
              Listo
            </button>
          </div>
          {shareResult === "downloaded" && (
            <p className="mt-2 text-center text-[11px] leading-snug text-white/50">
              Compartir no estaba disponible: el informe TXT se descargó para
              enviarlo por WhatsApp.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Corriendo: checklist superior + banner + abortar ──
  const stepIdx = QA_STEPS.findIndex((s) => s.id === step);
  return (
    <div className="pointer-events-none absolute inset-0 z-[80] flex flex-col">
      {/* Banner del paso (cámara: sostén/reencuadra · fallback manual) */}
      {hint && (
        <div className="absolute inset-x-0 top-[30%] z-[81] flex justify-center px-6">
          <div
            role="status"
            className={cn(
              "flex items-center gap-2.5 rounded-[20px] px-4 py-2.5 text-[14px] font-medium text-white shadow-lg backdrop-blur-md",
              manualPrompt ? "bg-[#ff9f0a]/90" : "bg-black/75"
            )}
          >
            {manualPrompt ? (
              <X className="h-4 w-4 shrink-0" strokeWidth={2.6} aria-hidden="true" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            <span className="text-center">{hint}</span>
          </div>
        </div>
      )}

      {/* Panel: checklist + tiempo + abortar */}
      <div className="pointer-events-auto absolute inset-x-3 top-3 z-[82] rounded-2xl bg-black/80 p-3 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-[12.5px] font-semibold tracking-wide text-white/90">
            TEST ESTÁNDAR v1.1
            <span className="ml-2 font-normal tabular-nums text-white/55">
              {fmtSec(elapsedMs)}
            </span>
          </span>
          <button
            type="button"
            data-qa-abort
            onClick={() => qaStandardTest.abort()}
            className="flex h-8 items-center gap-1 rounded-full bg-[#ff453a]/90 px-3 text-[12.5px] font-semibold text-white transition-transform active:scale-95"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.8} aria-hidden="true" />
            Abortar
          </button>
        </div>

        <div className="max-h-36 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          <ol className="flex flex-col gap-[3px]">
            {QA_STEPS.map((s, i) => {
              const done = log.find((l) => l.id === s.id);
              const active = i === stepIdx;
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg px-2 py-[5px] text-[12px]",
                    active ? "bg-[#007aff]/25" : "opacity-90"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {done?.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34c759]" aria-hidden="true" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0a84ff]" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden="true" />
                    )}
                    <span className={cn("truncate", active ? "text-white" : "text-white/60")}>
                      {s.label}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-white/55">
                    {done?.ok
                      ? `${fmtSec(done.ms)}${done.mode ? ` · ${done.mode}` : ""}${
                          done.waitMs != null ? ` (espera ${fmtSec(done.waitMs)})` : ""
                        }`
                      : active && slow
                        ? "sigue trabajando…"
                        : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {slow && (
          <p className="pt-1.5 text-center text-[11px] leading-snug text-white/55">
            Sigue trabajando… en gama baja el OCR puede tardar hasta 1 min.
          </p>
        )}
      </div>
    </div>
  );
}
