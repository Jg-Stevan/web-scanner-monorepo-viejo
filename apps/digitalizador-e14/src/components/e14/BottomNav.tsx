"use client";

/**
 * BottomNav — STITCH REDESIGN (SPEC-e14-redesign-stitch §3.1.3, mocks):
 * barra `bg-[#080C0A] border-t border-brand-borderdim/80 px-4 py-2` con
 * 3 ítems flex justify-around.
 *  · Ítem ACTIVO (ESCANEAR): cápsula `w-10 h-8 rounded-full
 *    bg-brand-green/20 border border-brand-green text-brand-green
 *    shadow-[0_0_10px_rgba(0,230,118,0.2)]` + label 10px bold verde.
 *  · Inactivos: icono 20px gris-400 + label 10px medium gris-400.
 *  · ACTAS: conteo real «(N)» en el MISMO label (data-driven del store).
 *  · Home indicator: `w-32 h-1 bg-white/30 rounded-full` (mock 1) /
 *    `h-1 w-28 bg-gray-700/60` (mocks 2-6).
 *  · La vista `revision` sigue contando como ESCANEAR activo (el flujo de
 *    revisión ES el flujo del escáner) — solo presentación, `navegar`
 *    intacto. El slot `children` (CTAs de ReviewCtas) se conserva.
 */
import type { ReactNode } from "react";
import { useE14Store, type Vista } from "@/lib/e14/store";
import { StitchCameraIcon, StitchDocIcon, StitchGrid2Icon } from "./icons";

const ITEMS: { vista: Vista; label: string; Icon: typeof StitchCameraIcon }[] = [
  { vista: "escanear", label: "ESCANEAR", Icon: StitchCameraIcon },
  { vista: "actas", label: "ACTAS", Icon: StitchDocIcon },
  { vista: "resumen", label: "RESUMEN", Icon: StitchGrid2Icon },
];

export function BottomNav({ mode = "dark", children }: { mode?: "dark" | "app"; children?: ReactNode }) {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);

  return (
    <footer className="relative z-30 shrink-0 pb-safe">
      {/* Slot de CTAs (modo dark/REVISIÓN): sobre la barra, sobre el fondo
          de página — la barra inferior es una franja propia. */}
      {children && <div className="max-w-md mx-auto px-4 pt-1 pb-2">{children}</div>}
      <nav
        className="bg-[#080C0A] border-t border-brand-borderdim/80"
        aria-label="Navegación principal"
        data-mode={mode}
      >
        <div className="max-w-md mx-auto px-4 py-2 flex justify-around items-center">
          {ITEMS.map(({ vista: v, label, Icon }) => {
            // En REVISIÓN el activo vive en ESCANEAR (misma regla de siempre).
            const activo = vista === v || (vista === "revision" && v === "escanear");
            return (
              <button
                key={v}
                type="button"
                onClick={() => navegar(v)}
                aria-current={activo ? "page" : undefined}
                className="flex flex-col items-center gap-1 group py-1 px-3 select-none"
              >
                {activo ? (
                  <div className="w-10 h-8 rounded-full bg-brand-green/20 border border-brand-green flex items-center justify-center text-brand-green shadow-[0_0_10px_rgba(0,230,118,0.2)]">
                    <Icon className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-200">
                    <Icon className="w-5 h-5" />
                  </div>
                )}
                <span
                  className={`text-[10px] tracking-wider uppercase font-sans ${
                    activo ? "font-bold text-brand-green" : "font-medium text-gray-400"
                  }`}
                >
                  {label}
                  {v === "actas" ? ` (${actasSesion})` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {/* Home indicator (mock 1: w-32 h-1 bg-white/30). */}
        <div className="w-32 h-1 bg-white/30 rounded-full mx-auto my-2" aria-hidden />
      </nav>
    </footer>
  );
}
