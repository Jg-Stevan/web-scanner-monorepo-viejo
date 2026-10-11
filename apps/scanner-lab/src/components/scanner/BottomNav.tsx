"use client";

/**
 * Barra de navegación inferior estilo iOS (3 tabs + FAB "Nuevo escaneo").
 * Fondo blanco translúcido con blur, borde superior #E5E5EA, safe-area.
 *
 * v13-post-16 (pase de estilo):
 *  · Píldora activa deslizante detrás del icono (layoutId, el mismo patrón
 *    segmented control de los chips de orden) — el tinte azul viaja de tab
 *    en tab en vez de aparecer/disappear; con «Reducir movimiento» salta
 *    seco (layout animations desactivadas por MotionConfig).
 *  · El número del badge hace pop al cambiar (AnimatePresence popLayout,
 *    igual que la pill «Página X de Y» del editor) y aria-label con el
 *    valor final para lectores de pantalla.
 *  · focus-visible:ring en los 3 targets (paridad con el pase de anillos
 *    de v13-post-3 — aquí faltaban).
 *  · Tick háptico de 6ms al cambiar de tab (mismo gesto que goToPage del
 *    editor, v13-post-11; try/catch, no-op en iOS/escritorio).
 */

import { FileText, ScanLine, Settings } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useScannerStore } from "@jg-stevan/scanner-core/store";
import { cn } from "@/lib/utils";

/** Tick háptico corto (silencioso donde no hay vibratoria). */
function tick() {
  try {
    navigator.vibrate?.(6);
  } catch {
    /* sin permiso/hardware: no-op */
  }
}

export default function BottomNav() {
  const view = useScannerStore((s) => s.view);
  const setView = useScannerStore((s) => s.setView);
  // F-TRASH: el badge cuenta solo los documentos VIVOS (sin la papelera).
  const liveCount = useScannerStore((s) => s.documents.filter((d) => d.deletedAt === undefined).length);

  const tabs = [
    {
      id: "library" as const,
      label: "Documentos",
      icon: FileText,
      badge: liveCount,
    },
    { id: "settings" as const, label: "Ajustes", icon: Settings },
  ];

  /** Cambia de tab con tick háptico (solo si realmente cambia). */
  const select = (v: "library" | "settings") => {
    if (v !== view) tick();
    setView(v);
  };

  return (
    <footer className="ios-blur-bar-light relative z-20 shrink-0 pb-safe">
      <nav aria-label="Navegación principal" className="relative px-2 pt-2">
        <div className="flex items-end justify-around">
          {tabs.slice(0, 1).map((t) => (
            <NavTab key={t.id} tab={t} active={view === t.id} onSelect={select} />
          ))}

          {/* Botón central de escaneo (actúa como FAB integrado) */}
          <button
            type="button"
            aria-label="Escanear nuevo documento"
            onClick={() => {
              if (view !== "camera") tick();
              setView("camera");
            }}
            className="group relative -mt-6 flex w-24 flex-col items-center gap-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full bg-[#007aff] text-white",
                "shadow-[0_8px_24px_rgba(0,122,255,0.4)] transition-transform duration-150",
                "active:scale-90 group-hover:scale-105"
              )}
            >
              <ScanLine className="h-7 w-7" strokeWidth={2.2} />
            </span>
            <span className="text-[10px] font-semibold tracking-wide text-[#6d6d72] dark:text-[#8e8e93]">
              Escanear
            </span>
          </button>

          {tabs.slice(1).map((t) => (
            <NavTab key={t.id} tab={t} active={view === t.id} onSelect={select} />
          ))}
        </div>

        {/* Home indicator iOS */}
        <div className="home-indicator home-indicator-dark mt-2 mb-1" aria-hidden="true" />
      </nav>
    </footer>
  );
}

function NavTab({
  tab,
  active,
  onSelect,
}: {
  tab: { id: "library" | "settings"; label: string; icon: typeof FileText; badge?: number };
  active: boolean;
  onSelect: (v: "library" | "settings") => void;
}) {
  const Icon = tab.icon;
  const badge = typeof tab.badge === "number" && tab.id === "library" ? tab.badge : 0;
  return (
    <button
      type="button"
      aria-label={badge > 0 ? `${tab.label} · ${badge} ${badge === 1 ? "documento" : "documentos"}` : tab.label}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(tab.id)}
      className={cn(
        "flex w-24 flex-col items-center gap-1 rounded-xl py-1 outline-none transition-opacity active:opacity-60",
        "focus-visible:ring-2 focus-visible:ring-[#007aff]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      )}
    >
      <span className="relative flex h-8 w-14 items-center justify-center">
        {/* Tinte de fondo del tab activo — viaja de tab en tab (layoutId).
         * aria-hidden + pointer-events-none: decorativo, nunca intercepta. */}
        {active && (
          <motion.span
            key="nav-active-pill"
            layoutId="bottomnav-active"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full bg-[#007aff]/10 dark:bg-[#0a84ff]/20"
            transition={{ type: "spring", stiffness: 480, damping: 38 }}
          />
        )}
        <Icon
          className={cn("relative h-6 w-6", active ? "text-[#007aff]" : "text-[#6d6d72] dark:text-[#8e8e93]")}
          strokeWidth={active ? 2.2 : 1.8}
        />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#007aff] px-1 text-[10px] font-bold leading-none text-white">
            {/* popLayout: el número saliente se posiciona solo y no empuja
             * al entrante (mismo patrón de la pill de página del editor). */}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={badge}
                initial={{ y: -8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 8, opacity: 0 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="tabular-nums"
              >
                {badge}
              </motion.span>
            </AnimatePresence>
          </span>
        )}
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold tracking-wide",
          active ? "text-[#007aff]" : "text-[#6d6d72] dark:text-[#8e8e93]"
        )}
      >
        {tab.label}
      </span>
    </button>
  );
}
