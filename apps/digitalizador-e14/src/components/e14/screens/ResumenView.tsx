"use client";

/**
 * RESUMEN (§7.7 / C2) — "RESUMEN DE TRABAJO": progreso del puesto (barra
 * segmentada de 12), tarjetas de estadística (cola offline / rescaneos) e
 * historial de envíos con barra de acento por estado. Reactivo en vivo.
 */
import { useE14Store } from "@/lib/e14/store";
import type { HistorialRow } from "@/lib/e14/types";
import { SegmentedBar } from "../primitives";

function badgeEstado(estado: HistorialRow["estado"]) {
  switch (estado) {
    case "ENVIADO":
      return {
        label: "ENVIADO ✓",
        clases: "px-2.5 py-0.5 bg-[#00E676]/10 border border-[#00E676]/40 text-brand-green font-mono text-[11px]",
        barra: "bg-brand-green",
      };
    case "RESCANEO_REQUERIDO":
      return {
        label: "RESCANEO REQUERIDO ⚠️",
        clases: "px-2.5 py-0.5 bg-amber-400/10 border border-amber-400/40 text-amber-400 font-mono text-[11px]",
        barra: "bg-amber-400",
      };
    default:
      return {
        label: "REVISIÓN HUMANA",
        clases: "px-2.5 py-0.5 bg-amber-400/10 border border-amber-400/40 text-amber-400 font-mono text-[11px]",
        barra: "bg-amber-400",
      };
  }
}

export function ResumenView() {
  const completadas = useE14Store((s) => s.completadas);
  const asignadasHoy = useE14Store((s) => s.asignadasHoy);
  const colaOffline = useE14Store((s) => s.colaOffline);
  const solicitudesRescaneo = useE14Store((s) => s.solicitudesRescaneo);
  const historial = useE14Store((s) => s.historial);

  const pct = Math.round((completadas / asignadasHoy) * 100);
  const ultimaActividad = historial[0]?.hora ?? "—";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll bg-brand-black flex flex-col">
      {/* Header propio de la pantalla (estructura de ACTAS, §7.7; H1 corregido — ver D12) */}
      <header className="sticky top-0 z-40 w-full bg-brand-black/95 backdrop-blur border-b border-brand-border/60 flex items-center justify-between px-4 h-14 shrink-0">
        <h1 className="font-mono text-sm font-bold tracking-widest text-brand-green uppercase">
          RESUMEN DE TRABAJO
        </h1>
      </header>

      <div className="flex-grow flex flex-col gap-6 px-4 pt-4 pb-6 max-w-md mx-auto w-full">
        {/* Puesto actual */}
        <section className="flex justify-between items-end border-b border-brand-border pb-2">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">PUESTO ACTUAL</span>
            <h2 className="text-lg font-bold text-white uppercase">ROMA - CONSULADO</h2>
          </div>
        </section>

        {/* Progreso del puesto */}
        <div className="bg-brand-surface border border-brand-border p-3 flex flex-col gap-2 rounded-2xl">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-white">
              PROGRESO DEL PUESTO:{" "}
              <span className="font-mono font-extrabold text-brand-green">{pct}%</span>
            </span>
          </div>
          <SegmentedBar total={asignadasHoy} filled={completadas} tone="ok" />
          <span className="text-sm text-gray-400">
            Has completado {completadas} de {asignadasHoy} páginas asignadas hoy.
          </span>
        </div>

        {/* Tarjetas de estadística */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-amber-400">
              {String(colaOffline).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">PENDIENTES EN COLA (OFFLINE)</span>
          </div>
          <div className="bg-brand-surface border border-brand-border p-2.5 flex flex-col gap-1 rounded-2xl">
            <span className="font-mono text-3xl font-extrabold tabular-nums text-red-500">
              {String(solicitudesRescaneo).padStart(2, "0")}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-400">SOLICITUD DE RESCANEO</span>
          </div>
        </div>

        {/* Historial de envíos */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-gray-400">ÚLTIMOS ENVÍOS (HISTORIAL)</span>
            <span className="font-mono text-xs text-gray-400">ÚLT. ACT.: {ultimaActividad}</span>
          </div>
          <div className="flex flex-col max-h-96 overflow-y-auto thin-scroll rounded-xl border border-brand-border">
            {historial.map((fila) => {
              const badge = badgeEstado(fila.estado);
              return (
                <div
                  key={fila.id}
                  className="min-h-12 bg-brand-surface flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border last:border-b-0 relative overflow-hidden"
                >
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${badge.barra}`} aria-hidden />
                  <span className="font-mono text-[13px] text-white pl-1 min-w-0 truncate">
                    {fila.titulo}
                  </span>
                  <span className={`${badge.clases} whitespace-nowrap shrink-0 rounded-full`}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
