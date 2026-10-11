"use client";

/**
 * TopBar — solo en REVISIÓN (SPEC §8): ← + título + pill de
 * conexión (clic alterna EN LÍNEA/OFFLINE con toast). En ACTAS/RESUMEN el
 * título vive dentro de la propia pantalla.
 *
 * D1 (SPEC-rediseno-revision §1, heredada de SPEC-rediseno-enviada Rev. 2):
 * título DINÁMICO por estado del acta — `[● ⚠ 7.8/10 ADVERTENCIA · TÍTULO]`
 * con score real, palabra por estado y título truncado; fallback
 * «REVISIÓN DE ACTA» cuando no hay acta. Pill de conexión INTACTA.
 * ENMIENDA (SPEC-rediseno-revision): la palabra de ADVERTENCIA es
 * «ADVERTENCIA» (el mock manda sobre el «MODERADA» de Rev. 1 de la spec
 * ENVIADA) — tono warn/ámbar (coherencia semántica con breadcrumb y banner).
 */
import { useE14Store } from "@/lib/e14/store";
import type { Acta, ActaStatus } from "@/lib/e14/types";
import { ArrowLeftIcon, CloudCheckIcon, CloudOffIcon } from "./icons";

/** D1: estilo por estado — icono + palabra + tono + dot (mock vinculante). */
function estiloTopBar(status: ActaStatus, score: number) {
  switch (status) {
    case "ENVIADA":
    case "OPTIMA":
      // Misma regla del consumidor canónico (ReviewView ENVIADA): ≥8 ÓPTIMA,
      // <8 ENVIADA CON ADVERTENCIA (envío observado).
      return {
        icono: "✓",
        palabra: score >= 8 ? "ÓPTIMA" : "ENVIADA CON ADVERTENCIA",
        tono: "text-ok-tint",
        dot: "bg-ok-tint",
      };
    case "ADVERTENCIA":
      // Enmienda de esta spec: «ADVERTENCIA», tono ámbar.
      return { icono: "⚠", palabra: "ADVERTENCIA", tono: "text-warn", dot: "bg-warn" };
    case "RECHAZADA":
      return { icono: "✕", palabra: "RECHAZADA", tono: "text-crit", dot: "bg-crit" };
    case "EN_REVISION_HUMANA":
      return { icono: "⚠", palabra: "REVISIÓN HUMANA", tono: "text-warn", dot: "bg-warn" };
  }
}

/** D1: título dinámico `[● ⚠ 7.8/10 ADVERTENCIA · ROMA CONSULADO]`. */
function TituloDinamico({ acta }: { acta: Acta }) {
  const est = estiloTopBar(acta.status, acta.score);
  return (
    <h1
      className={`text-sm font-extrabold tracking-wider uppercase text-center flex items-center gap-1.5 min-w-0 max-w-[230px] ${est.tono}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 animate-pulse-sync ${est.dot}`} aria-hidden />
      <span className="shrink-0 font-mono">
        {est.icono} {acta.score.toFixed(1)}/10
      </span>
      <span className="shrink-0">{est.palabra}</span>
      <span className="text-ink-faint shrink-0" aria-hidden>
        ·
      </span>
      <span className="truncate min-w-0">{acta.titulo}</span>
    </h1>
  );
}

export function TopBar() {
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const navegar = useE14Store((s) => s.navegar);
  const acta = useE14Store((s) => s.actaActual);

  return (
    <header className="relative z-40 bg-bg/95 backdrop-blur-md border-b border-line pt-safe shrink-0">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
        <button
          aria-label="Volver al menú de escaneo"
          type="button"
          onClick={() => navegar("escanear")}
          className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-ok-tint active:bg-white/10 active:scale-95 transition-transform duration-150"
        >
          <ArrowLeftIcon />
        </button>
        <div className="flex flex-col items-center min-w-0">
          {acta ? (
            <TituloDinamico acta={acta} />
          ) : (
            <h1 className="text-base font-extrabold tracking-wider text-ok-tint uppercase text-center flex items-center gap-1.5">
              REVISIÓN DE ACTA
            </h1>
          )}
          <span className="text-[10px] text-ink-faint uppercase tracking-widest font-mono">
            E-14&nbsp;
          </span>
        </div>
        <div className="w-11 h-11 -mr-2 flex items-center justify-center">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ok-ink/60 border border-ok-tint/40">
            <span
              className={`w-2 h-2 rounded-full animate-pulse-sync ${online ? "bg-ok-tint" : "bg-warn"}`}
            />
            {online ? <CloudCheckIcon className="w-3.5 h-3.5 text-ok-tint" /> : <CloudOffIcon className="w-3.5 h-3.5 text-warn" />}
          </div>
        </div>
      </div>
      {/* La pill del header también alterna la conexión (§7.4). */}
      <button type="button" aria-hidden tabIndex={-1} className="sr-only" onClick={alternarConexion}>
        Alternar conexión
      </button>
    </header>
  );
}
