/**
 * Primitivas del design system STITCH (SPEC-e14-redesign-stitch §1/§3.2).
 * Todo re-vestido con los tokens canónicos del ZIP — NADA del tema
 * anterior (AC9). Tone: "ok" | "warn" | "crit" | "neutral".
 * "use client";
 */

import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "crit" | "neutral";

const toneDot: Record<Tone, string> = {
  ok: "bg-brand-green",
  warn: "bg-amber-400",
  crit: "bg-red-500",
  neutral: "bg-gray-400",
};

const toneText: Record<Tone, string> = {
  ok: "text-brand-green",
  warn: "text-amber-400",
  crit: "text-red-500",
  neutral: "text-gray-400",
};

/** Dot de estado (mock: w-2 h-2 rounded-full del color del estado). */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${toneDot[tone]} ${
        pulse ? "animate-pulse-sync" : ""
      }`}
    />
  );
}

/** Chip del chrome (mock §3.2.3): `grid grid-cols-3 gap-2` — el ACTIVO es
 *  relleno sólido del color del estado (mono extrabold xs), los otros 2
 *  surfaceLight con borde. `solid` = relleno del tono. */
export function Chip({
  tone = "neutral",
  solid = false,
  children,
  className = "",
}: {
  tone?: Tone;
  solid?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (solid) {
    return (
      <span
        className={`py-2 px-1 rounded-xl font-mono font-extrabold text-xs tracking-wider uppercase shadow-sm tap-action flex items-center justify-center ${
          tone === "ok"
            ? "bg-brand-green text-black"
            : tone === "warn"
              ? "bg-[#F59E0B] text-black"
              : tone === "crit"
                ? "bg-red-600 text-white"
                : "bg-brand-surfacelight text-white"
        } ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={`py-2 px-1 rounded-xl bg-brand-surfacelight border border-brand-border text-white font-mono font-bold text-xs tracking-wider uppercase tap-action flex items-center justify-center ${className}`}
    >
      {children}
    </span>
  );
}

/** Barra segmentada (4px) para datos fraccionarios. */
export function SegmentedBar({
  total,
  filled,
  tone = "ok",
  className = "",
}: {
  total: number;
  filled: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 w-full h-1 ${className}`} role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-[1px] ${i < filled ? toneDot[tone] : "bg-brand-border"}`}
        />
      ))}
    </div>
  );
}

/** Botón de la fila de acciones de revisión (Recortar · Rotar 90° ·
 *  Pantalla completa — mock §3.2.5): `py-2 px-2 rounded-xl bg-brand-surface
 *  border border-brand-border text-gray-300 text-xs`. La fila es NEUTRA
 *  (el estado vive en esquinas AR + píldora flotante — la prop `tone`
 *  queda aceptada por compat y NO pinta nada especial). `active` (F-OCR
 *  D39) solo cambia el tinte (borde + texto verde), mismo tamaño. */
export function ToolbarBtn({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** D39/F-OCR: distingue el botón cuando ya hay texto reconocido. */
  active?: boolean;
  /** Compat — ignorado (fila neutra, SPEC §3.2.5). */
  tone?: "crit";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 py-2 px-2 rounded-xl border font-sans font-medium text-xs flex items-center justify-center gap-1.5 tap-action transition-colors leading-tight text-center ${
        active
          ? "bg-brand-surface border-brand-green/50 text-brand-green"
          : "bg-brand-surface border-brand-border text-gray-300 hover:bg-brand-surfacelight"
      }`}
    >
      <span className={`shrink-0 flex items-center justify-center ${active ? "text-brand-green" : "text-gray-300"}`}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Botón CTA grande del footer (mocks 2-6):
 *  · ok → verde sólido «SEGUIR ESCANEANDO» (py-3.5 rounded-2xl, glow verde)
 *  · crit → rojo sólido «OBLIGATORIO REPETIR FOTO» (py-3.5-4, glow rojo)
 *  · warn → ámbar outline «REPETIR FOTO» (py-2.5 rounded-xl mono)
 *  · outline / outline-* → REVISIÓN HUMANA surface/border (§3.2.6). */
export function PrimaryBtn({
  variant = "ok",
  onClick,
  icon,
  children,
  ariaLabel,
  disabled = false,
}: {
  variant?: "ok" | "warn" | "crit" | "outline" | "outline-crit" | "outline-warn";
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  ariaLabel?: string;
  /** Panel §5: GUARDAR UBICACIÓN hasta completar la cascada. */
  disabled?: boolean;
}) {
  const base =
    "flex-1 min-w-0 px-3 flex items-center justify-center gap-2 uppercase tracking-wider leading-tight text-center transition-all tap-action";
  const styles: Record<string, string> = {
    ok: "bg-brand-green hover:bg-emerald-400 text-black font-extrabold text-sm py-3.5 px-6 rounded-2xl shadow-[0_4px_20px_rgba(0,230,118,0.35)]",
    crit: "bg-[#E52222] hover:bg-red-600 text-white font-black text-xs sm:text-sm py-3.5 rounded-2xl shadow-[0_4px_20px_rgba(229,34,34,0.4)]",
    warn: "bg-brand-surface hover:bg-brand-surfacelight border border-amber-500/80 text-amber-400 font-mono font-bold text-[10px] py-2.5 rounded-xl shadow-sm",
    outline:
      "bg-brand-surface hover:bg-brand-surfacelight border border-brand-border text-gray-200 font-bold text-xs py-3.5 rounded-2xl",
    "outline-crit":
      "bg-brand-surface hover:bg-brand-surfacelight border border-brand-border text-gray-200 font-bold text-xs py-3.5 rounded-2xl",
    "outline-warn":
      "bg-brand-surface hover:bg-brand-surfacelight border border-brand-border text-gray-200 font-bold text-xs py-3.5 rounded-2xl",
  };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      className={`${base} ${styles[variant]} ${disabled ? "opacity-40 cursor-not-allowed shadow-none" : ""}`}
    >
      {icon && <span className={`shrink-0 flex items-center justify-center ${toneText[variant === "ok" ? "ok" : variant === "crit" ? "crit" : variant === "warn" ? "warn" : "neutral"]}`}>{icon}</span>}
      <span>{children}</span>
    </button>
  );
}
