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
 * BORDEADA de estado del mock.
 * CYBER-NEÓN (SPEC-e14-cyber-neon §3): cápsula 34px bg surface-1 con anillo
 * verde (borde 35% + glow-sm por tono de estado, §10); punto SÓLIDO 12px
 * SIN animar (fuera animate-pulse-sync y el ▲ de warn — la estructura del
 * mock es punto + score + palabra); score verde neón y palabra BLANCA en
 * dos spans (13px bold tracking 0.08em, mono); botón derecho = cápsula con
 * anillo verde + nube 18px + punto 1.5px (la función de alternar conexión
 * queda INTACTA). Flecha «←» neón con strokeWidth 2.5 (§3.3).
 */
import { useE14Store } from "@/lib/e14/store";
import type { Acta, ActaStatus } from "@/lib/e14/types";
import { ArrowLeftIcon, CloudCheckIcon, CloudOffIcon } from "./icons";

/** D1: estilo por estado — palabra + tono + dot + borde + glow (mock vinculante). */
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
        tonoBorde: "border-ok-tint/35",
        glow: "glow-sm",
      };
    case "ADVERTENCIA":
      // Enmienda de la spec de revisión: «ADVERTENCIA», tono ámbar.
      return {
        palabra: "ADVERTENCIA",
        tono: "text-warn",
        dot: "bg-warn",
        tonoBorde: "border-warn/35",
        glow: "glow-sm-warn",
      };
    case "RECHAZADA":
      return {
        palabra: "RECHAZADA",
        tono: "text-crit",
        dot: "bg-crit",
        tonoBorde: "border-crit/35",
        glow: "glow-sm-crit",
      };
    case "EN_REVISION_HUMANA":
      return {
        palabra: "REVISIÓN HUMANA",
        tono: "text-warn",
        dot: "bg-warn",
        tonoBorde: "border-warn/35",
        glow: "glow-sm-warn",
      };
  }
}

// D1 (SPEC-rediseno-chrome-3-estados): el título del acta BAJA al banner
// (D2 en ReviewView); la TopBar solo porta la pill de ESTADO del mock.
/** D1 Rev. 3: pill bordeada redondeada — CYBER-NEÓN §3.1: cápsula 34px
 *  bg surface-1, punto sólido 12px sin animar, score neón + palabra blanca. */
function PillEstado({ acta }: { acta: Acta }) {
  const est = estiloTopBar(acta.status, acta.score);
  return (
    <div
      className={`flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-surface-1 border font-data ${est.tonoBorde} ${est.glow}`}
      role="status"
    >
      <span className={`w-3 h-3 rounded-full shrink-0 ${est.dot}`} aria-hidden />
      <span className={`text-[13px] font-bold tracking-[0.08em] shrink-0 ${est.tono}`}>
        {acta.score.toFixed(1)}/10
      </span>
      <span className="text-[13px] font-bold tracking-[0.08em] text-white shrink-0">
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

  return (
    <header className="relative z-40 bg-bg pt-safe shrink-0">
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
          <h1 className="font-data text-[13px] font-bold tracking-[0.08em] text-ok-tint uppercase text-center">
            REVISIÓN DE ACTA
          </h1>
        )}
        <div className="w-11 h-11 -mr-2 flex items-center justify-center">
          <div
            className={`flex items-center gap-1.5 h-[34px] px-3 rounded-full bg-surface-1 border ${
              online ? "border-ok-tint/40 glow-sm" : "border-warn/40 glow-sm-warn"
            }`}
          >
            {online ? (
              <CloudCheckIcon className="w-[18px] text-ok-tint" />
            ) : (
              <CloudOffIcon className="w-[18px] text-warn" />
            )}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-ok-tint" : "bg-warn"}`}
              aria-hidden
            />
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
