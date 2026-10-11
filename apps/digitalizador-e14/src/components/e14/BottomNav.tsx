"use client";

/**
 * BottomNav — CYBER-NEÓN (SPEC-e14-cyber-neon §9): barra tipo app nativa.
 *  · Barra `bg-nav-bg` (#0E1319) con `border-t white/5`, alto total 78px
 *    (ítems 70px + home-indicator 130×4 white/20) y safe-area respetada
 *    (`pb-safe`).
 *  · Ítem ACTIVO (ESCANEAR): icono de cámara 22px dentro de ELIPSE
 *    46×40 `rounded-[50%]` con `border-2` neón + glow-sm; label 10px
 *    bold tracking 0.14em neón. Los demás ítems usan el MISMO contenedor
 *    (borde transparente) para alinear los labels.
 *  · ACTAS: documento OUTLINE (strokeWidth 1.8) + conteo real «(N)» bajo
 *    el label (9px ink-dim) — SUSTITUYE el badge rojo puntual (el número
 *    sigue data-driven del store: `actasSesion`); las contingencias siguen
 *    visibles en ACTAS/RESUMEN.
 *  · RESUMEN: `GridIcon` NUEVO = cuadrícula 2×2 de 4 cuadritos redondeados.
 *  · Iconos inactivos: trazo claro #C7CEDA (bien visible, no apagado).
 *  · El mock (estado ENVIADA = vista «revision») anilla ESCANEAR: la
 *    revisión ES el flujo del escáner → `revision` cuenta como activo de
 *    ESCANEAR (solo presentación, `navegar` intacto).
 *  · El slot `children` (CTAs de ReviewCtas sobre el nav, modo dark) se
 *    conserva; el modo «app» (ACTAS/RESUMEN) comparte la MISMA barra —
 *    la capa visual es global (§2: toda la app hereda los tokens).
 * D8 (SPEC-rediseno-revision §8, heredada): el conteo de contingencias ya
 * NO vive aquí (sustituido por «(N)»); ResumenView/ActasView lo listan.
 */
import type { ReactNode } from "react";
import { useE14Store, type Vista } from "@/lib/e14/store";
import { CameraNavIcon, DocumentNavIcon, GridIcon } from "./icons";

const ITEMS: { vista: Vista; label: string; Icon: typeof CameraNavIcon }[] = [
  { vista: "escanear", label: "ESCANEAR", Icon: CameraNavIcon },
  { vista: "actas", label: "ACTAS", Icon: DocumentNavIcon },
  { vista: "resumen", label: "RESUMEN", Icon: GridIcon },
];

/** Contenedor de icono: MISMA caja 46×40 en todos los ítems — el activo
 *  enciende el anillo elíptico neón, el inactivo queda transparente. */
function IconoNav({
  activo,
  children,
}: {
  activo: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`w-[46px] h-[40px] rounded-[50%] flex items-center justify-center ${
        activo
          ? "border-2 border-ok-tint glow-sm text-ok-tint"
          : "border-2 border-transparent text-[#C7CEDA]"
      }`}
    >
      {children}
    </div>
  );
}

export function BottomNav({ mode = "dark", children }: { mode?: "dark" | "app"; children?: ReactNode }) {
  const vista = useE14Store((s) => s.vista);
  const navegar = useE14Store((s) => s.navegar);
  const actasSesion = useE14Store((s) => s.actasSesion);

  return (
    <footer className="relative z-40 shrink-0 pb-safe">
      {/* Slot de CTAs (modo dark/REVISIÓN): sobre la barra, sobre el fondo
          de página — la barra inferior es una franja propia (#0E1319). */}
      {children && <div className="max-w-md mx-auto px-4 pt-1 pb-2">{children}</div>}
      <nav
        className="bg-nav-bg border-t border-white/5"
        aria-label="Navegación principal"
        data-mode={mode}
      >
        <div className="max-w-md mx-auto grid grid-cols-3 h-[73px]">
          {ITEMS.map(({ vista: v, label, Icon }) => {
            // §9: en REVISIÓN (mock ENVIADA) el anillo vive en ESCANEAR.
            const activo = vista === v || (vista === "revision" && v === "escanear");
            return (
              <button
                key={v}
                type="button"
                onClick={() => navegar(v)}
                aria-current={activo ? "page" : undefined}
                className="flex flex-col items-center justify-center gap-0.5"
              >
                <IconoNav activo={activo}>
                  <Icon className={v === "escanear" ? "w-[22px] h-[22px]" : "w-[19px] h-[19px]"} />
                </IconoNav>
                <span
                  className={`font-data text-[10px] font-bold tracking-[0.14em] uppercase ${
                    activo ? "text-ok-tint" : "text-ink-dim"
                  }`}
                >
                  {label}
                </span>
                {/* §9 ACTAS: conteo real «(N)» bajo el label (data-driven). */}
                {v === "actas" && (
                  <span className="font-data text-[9px] text-ink-dim leading-none">({actasSesion})</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Home indicator (barra 78px total: 70 ítems + 4 indicador + margen). */}
        <div className="w-[130px] h-[4px] rounded-full bg-white/20 mx-auto mb-1" aria-hidden />
      </nav>
    </footer>
  );
}
