"use client";

/**
 * TopBar — solo en REVISIÓN. STITCH REDESIGN (SPEC-e14-redesign-stitch
 * §3.2.1, mock 6/2/4): [retro ← verde w-10 h-10] · [píldora de estado:
 * dot ping del color + score font-mono del color + label blanco uppercase
 * 11px; contenedor bg-brand-surface con borde del color (rechazada
 * border-red-500/40 · advertencia bg-amber-950/60 + glow · óptima
 * border-brand-green/30 + glow verde)] · [nube de transmisión: verde
 * (bg-brand-greenDark) online+transmitida · roja offline/rechazada ·
 * ámbar pendiente de envío — mapeo §6.4/AC11].
 * La lógica de datos (palabra real por estado, score real, alternar
 * conexión) queda INTACTA de D1 — solo re-vestida.
 */
import { useE14Store } from "@/lib/e14/store";
import type { Acta, ActaStatus } from "@/lib/e14/types";
import { StitchArrowLeftIcon, StitchCloudCheckIcon } from "./icons";

/** D1: estilo por estado — palabra + colores del mock vinculante. */
function estiloTopBar(status: ActaStatus, score: number) {
  switch (status) {
    case "ENVIADA":
    case "OPTIMA":
      // Misma regla del consumidor canónico (ReviewView ENVIADA): ≥8 ÓPTIMA,
      // <8 ENVIADA CON ADVERTENCIA (envío observado).
      return {
        palabra: score >= 8 ? "ÓPTIMA" : "ENVIADA CON ADVERTENCIA",
        pill: "bg-brand-surface border border-brand-green/30 shadow-[0_0_12px_rgba(0,230,118,0.15)]",
        dot: "bg-brand-green",
        ping: true,
        score: "text-brand-green",
      };
    case "ADVERTENCIA":
      // Mock 4: píldora ámbar con glow (bg amber-950/60).
      return {
        palabra: "ADVERTENCIA",
        pill:
          "bg-amber-950/60 border border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
        dot: "bg-amber-400",
        ping: false,
        score: "text-amber-400",
      };
    case "RECHAZADA":
      return {
        palabra: "RECHAZADA",
        pill: "bg-brand-surface border border-red-500/40 shadow-sm",
        dot: "bg-red-500",
        ping: true,
        score: "text-red-500",
      };
    case "EN_REVISION_HUMANA":
      return {
        palabra: "REVISIÓN HUMANA",
        pill:
          "bg-amber-950/60 border border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
        dot: "bg-amber-400",
        ping: false,
        score: "text-amber-400",
      };
  }
}

/** Nube de transmisión (§6.4/AC11 — mapeo implementado):
 *  · VERDE  = online y (ENVIADA u ÓPTIMA a punto de auto-enviarse)
 *  · ROJA   = offline (cola pendiente) o RECHAZADA (no se transmite)
 *  · ÁMBAR  = ADVERTENCIA / EN_REVISION_HUMANA online (pendiente de envío) */
function nubeTransmision(status: ActaStatus, online: boolean) {
  if (!online || status === "RECHAZADA") {
    return "bg-red-500/20 border border-red-500/40 text-red-500";
  }
  if (status === "ENVIADA" || status === "OPTIMA") {
    return "bg-brand-greendark border border-brand-green/40 text-brand-green";
  }
  return "bg-amber-950/60 border border-amber-500 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]";
}

function PillEstado({ acta }: { acta: Acta }) {
  const est = estiloTopBar(acta.status, acta.score);
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs ${est.pill}`}
      role="status"
    >
      {est.ping ? (
        <span className="relative flex h-2.5 w-2.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${est.dot} opacity-75`} />
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${est.dot}`} />
        </span>
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${est.dot}`} aria-hidden />
      )}
      <span className={`font-mono font-bold ${est.score}`}>{acta.score.toFixed(1)}/10</span>
      <span className="text-white font-semibold uppercase tracking-wider text-[11px]">
        {est.palabra}
      </span>
    </div>
  );
}

export function TopBar() {
  const online = useE14Store((s) => s.online);
  const alternarConexion = useE14Store((s) => s.alternarConexion);
  const navegar = useE14Store((s) => s.navegar);
  const acta = useE14Store((s) => s.actaActual);

  const nube = acta ? nubeTransmision(acta.status, online) : null;

  return (
    <header className="relative z-30 pt-safe shrink-0 bg-brand-black/95 backdrop-blur border-b border-brand-border/60">
      <div className="max-w-md mx-auto px-4 pt-4 pb-2.5 flex items-center justify-between gap-2">
        <button
          aria-label="Volver al menú de escaneo"
          type="button"
          onClick={() => navegar("escanear")}
          className="w-10 h-10 rounded-full flex items-center justify-center text-brand-green hover:bg-brand-surfacelight tap-action transition-colors"
        >
          <StitchArrowLeftIcon />
        </button>
        {acta ? (
          <PillEstado acta={acta} />
        ) : (
          <h1 className="font-mono font-bold text-[11px] uppercase tracking-wider text-brand-green text-center">
            REVISIÓN DE ACTA
          </h1>
        )}
        {nube ? (
          <div
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs ${nube}`}
            title={
              online
                ? "En línea — los envíos se transmiten al servidor"
                : "Sin conexión — los envíos se acumulan en cola local"
            }
          >
            <StitchCloudCheckIcon className="w-4 h-4" />
            <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
          </div>
        ) : (
          <div className="w-10 h-10" aria-hidden />
        )}
      </div>
      {/* §7.4: la pill alterna la conexión (accesible por teclado). */}
      <button type="button" aria-hidden tabIndex={-1} className="sr-only" onClick={alternarConexion}>
        Alternar conexión
      </button>
    </header>
  );
}
