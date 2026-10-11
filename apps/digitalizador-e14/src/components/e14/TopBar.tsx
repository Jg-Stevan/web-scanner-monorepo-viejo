"use client";

/**
 * TopBar — solo en REVISIÓN (SPEC §8): ← + pill de estado + pill de
 * conexión (clic alterna EN LÍNEA/OFFLINE con toast). En ACTAS/RESUMEN el
 * título vive dentro de la propia pantalla.
 *
 * D1 (SPEC-rediseno-revision §1, heredada de SPEC-rediseno-enviada Rev. 2):
 * estado dinámico por acta con score y palabra REALES (palabras aprobadas:
 * ÓPTIMA/ENVIADA CON ADVERTENCIA/ADVERTENCIA/REVISIÓN HUMANA/RECHAZADA — el
 * acento de «ÓPTIMA» se conserva, el mock lo omite por estilización);
 * fallback «REVISIÓN DE ACTA» cuando no hay acta. Pill de conexión INTACTA.
 * D1 Rev. 3 (SPEC-rediseno-chrome-3-estados): el título del acta BAJA al
 * banner de ubicación (D2 en ReviewView) — la TopBar porta SOLO la pill
 * BORDEADA de estado del mock `[● ▲ 4.2/10 RECHAZADA]`; icono ▲ SOLO en
 * estados warn (WarnTriangleIcon — sustituye al carácter «⚠»); ✓/✕ dejan
 * de renderizarse (los mocks no los dibujan) y el subtítulo «E-14» sale.
 */
import { useE14Store } from "@/lib/e14/store";
import type { Acta, ActaStatus } from "@/lib/e14/types";
import { ArrowLeftIcon, CloudCheckIcon, CloudOffIcon, WarnTriangleIcon } from "./icons";

/** D1: estilo por estado — palabra + tono + dot + tonoBorde (mock vinculante). */
function estiloTopBar(status: ActaStatus, score: number) {
  switch (status) {
    case "ENVIADA":
    case "OPTIMA":
      // Misma regla del consumidor canónico (ReviewView ENVIADA): ≥8 ÓPTIMA,
      // <8 ENVIADA CON ADVERTENCIA (envío observado).
      return {
        palabra: score >= 8 ? "ÓPTIMA" : "ENVIADA CON ADVERTENCIA",
        tono: "text-ok-tint",
        dot: "bg-ok-tint",
        tonoBorde: "border-ok-tint",
      };
    case "ADVERTENCIA":
      // Enmienda de la spec de revisión: «ADVERTENCIA», tono ámbar.
      return { palabra: "ADVERTENCIA", tono: "text-warn", dot: "bg-warn", tonoBorde: "border-warn" };
    case "RECHAZADA":
      return { palabra: "RECHAZADA", tono: "text-crit", dot: "bg-crit", tonoBorde: "border-crit" };
    case "EN_REVISION_HUMANA":
      return { palabra: "REVISIÓN HUMANA", tono: "text-warn", dot: "bg-warn", tonoBorde: "border-warn" };
  }
}

// D1 (SPEC-rediseno-chrome-3-estados): el título del acta BAJA al banner
// (D2 en ReviewView); la TopBar solo porta la pill de ESTADO del mock.
/** D1 Rev. 3: pill bordeada redondeada `[● ▲ 4.2/10 RECHAZADA]` (sin título). */
function PillEstado({ acta }: { acta: Acta }) {
  const est = estiloTopBar(acta.status, acta.score);
  const esWarn = acta.status === "ADVERTENCIA" || acta.status === "EN_REVISION_HUMANA";
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full border bg-bg/60 ${est.tonoBorde}`}
      role="status"
    >
      <span className={`w-1.5 h-1.5 rounded-full animate-pulse-sync shrink-0 ${est.dot}`} aria-hidden />
      {esWarn && <WarnTriangleIcon className="w-3 h-3 shrink-0" />}
      <span className={`font-data text-[11px] font-bold tracking-wide shrink-0 ${est.tono}`}>
        {acta.score.toFixed(1)}/10 {est.palabra}
      </span>
    </div>
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
        {acta ? (
          <PillEstado acta={acta} />
        ) : (
          <h1 className="text-base font-extrabold tracking-wider text-ok-tint uppercase text-center">
            REVISIÓN DE ACTA
          </h1>
        )}
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
