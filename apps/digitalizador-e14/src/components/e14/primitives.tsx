/**
 * Primitivas del design system Precision Monitor (SPEC §3).
 * Tone: "ok" | "warn" | "crit" | "neutral" — siempre sobre tokens §5.
 */
"use client";

import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "crit" | "neutral";

const toneText: Record<Tone, string> = {
  ok: "text-ok-tint",
  warn: "text-warn",
  crit: "text-crit",
  neutral: "text-ink-dim",
};

const toneBg: Record<Tone, string> = {
  ok: "bg-ok-tint",
  warn: "bg-warn",
  crit: "bg-crit",
  neutral: "bg-ink-dim",
};

/** Dot de estado (8px) con latido opcional (code.html: animate-pulse-sync). */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${toneBg[tone]} ${
        pulse ? "animate-pulse-sync" : ""
      }`}
    />
  );
}

/** Chip del chrome — CYBER-NEÓN (SPEC-e14-cyber-neon §5): cápsula 34px
 *  mono bold tracking 0.14em. `solid` = relleno SÓLIDO del tono con texto
 *  NEGRO + glow-sm (chip 1 TRANSMISIÓN — cambio núm. 1 de la fila);
 *  inactivo = navy surface-3 + texto blanco + borde white/6 (§5).
 *  El TONO del sólido sigue elegido por estado (§10: ok/crit/ámbar). */
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
        className={`inline-flex items-center h-[34px] px-4 rounded-full font-data text-[11px] font-bold tracking-[0.14em] uppercase whitespace-nowrap ${
          tone === "ok"
            ? "bg-ok-tint text-neon-ink glow-sm"
            : tone === "warn"
              ? "bg-warn text-neon-ink glow-sm-warn"
              : tone === "crit"
                ? "bg-crit text-neon-ink glow-sm-crit"
                : "bg-ink-dim text-bg"
        } ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center h-[34px] px-4 rounded-full font-data text-[11px] font-bold tracking-[0.14em] uppercase whitespace-nowrap bg-surface-3 text-white border border-white/6 ${className}`}
    >
      {children}
    </span>
  );
}

/** Badge de score ("✓ 9.8/10 ÓPTIMA" / "✕ 4.2/10 RECHAZADA"). */
export function ScoreBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border font-data whitespace-nowrap ${
        tone === "ok"
          ? "text-ok-tint bg-ok-tint/15 border-ok-tint/30"
          : tone === "warn"
            ? "text-warn bg-warn/15 border-warn/30"
            : tone === "crit"
              ? "text-crit bg-crit/15 border-crit/30"
              : "text-ink-dim bg-black/60 border-line"
      }`}
    >
      {children}
    </span>
  );
}

/** Barra segmentada (4px) para datos fraccionarios (DESIGN.md). */
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
          className={`h-1 flex-1 rounded-[1px] ${i < filled ? toneBg[tone] : "bg-line"}`}
        />
      ))}
    </div>
  );
}

/** Botón de la barra fija de revisión (Recortar / Rotar / Filtros / Texto /
 *  Pantalla completa). F5/D38: alto táctil 44px GARANTIZADO y label
 *  `truncate` — la barra nunca cambia de tamaño al girar el documento o
 *  cambiar de estado. F-OCR/D39: prop opcional `active` — re-vestido del
 *  ToolItem del lab (Fuente: apps/scanner-lab/src/components/scanner/
 *  EditorView.tsx L2205-2210 — `active={page?.ocrDone === true}`, L2208):
 *  cuando active, solo cambia el TINTE (borde + texto + fondo 10%) —
 *  alto/tamaño IDÉNTICOS (criterio D38 sigue vigente).
 *  D5 (SPEC-rediseno-chrome-3-estados Rev. 3): prop opcional `tone` —
 *  con "crit" el botón se pinta ROJO SÓLIDO (mock 1) — SOLO lo usa
 *  «Recortar» en RECHAZADA.
 *  CYBER-NEÓN (SPEC-e14-cyber-neon §2 tipografía + §10): cápsula
 *  rounded-full, mono bold uppercase tracking 0.1em, neutro = navy
 *  surface-3 + borde white/6 (mismo lenguaje que los chips 2-3),
 *  tono crit sólido con glow-sm-crit. */
export function ToolbarBtn({
  icon,
  label,
  onClick,
  active = false,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  /** D39/F-OCR: distingue el botón cuando ya hay texto reconocido. */
  active?: boolean;
  /** D5 Rev. 3: «Recortar» rojo sólido en RECHAZADA (mock 1). */
  tone?: "crit";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 min-h-11 h-11 px-3 rounded-full active:scale-95 transition-all flex items-center justify-center gap-1.5 font-data text-[10px] font-bold tracking-[0.1em] uppercase border ${
        tone === "crit"
          ? "bg-crit border-crit text-white glow-sm-crit"
          : active
            ? "border-ok-tint/40 bg-ok-tint/10 text-ok-tint"
            : "bg-surface-3 border-white/6 text-ink"
      }`}
    >
      <span className={`${tone === "crit" ? "text-white" : "text-ok-tint"} shrink-0 flex items-center justify-center`}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Botón CTA grande del footer — CYBER-NEÓN (SPEC-e14-cyber-neon §8):
 * cápsula 52px radio completo, mono extrabold uppercase; el relleno
 * sólido lleva glow-cta del tono (§10) y el outline-warn (REVISIÓN
 * HUMANA, §10) = bg warn/12 + borde warn/40 + glow ámbar.
 * variant: "ok" (neón sólido #03DF73 + texto negro) · "warn" · "crit" ·
 * "outline" (oscuro) · "outline-crit" · "outline-warn".
 */
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
    "flex-1 min-w-0 h-[52px] px-2.5 rounded-full flex items-center justify-center gap-2 font-data font-extrabold text-[10px] md:text-[11px] uppercase tracking-[0.1em] transition-all transform active:scale-[0.98] leading-tight text-center";
  const styles: Record<string, string> = {
    ok: "bg-neon-strong hover:bg-neon-strong/90 text-neon-ink glow-cta",
    warn: "bg-warn hover:bg-warn/90 active:bg-warn/80 text-warn-ink glow-cta-warn",
    crit: "bg-crit hover:bg-crit/90 active:bg-crit-deep text-white glow-cta-crit",
    outline: "bg-surface-2 hover:bg-hover text-ink-dim border border-outline-dim",
    "outline-crit": "bg-white/5 hover:bg-white/10 text-ink-dim border border-crit/30",
    "outline-warn": "bg-warn/12 hover:bg-warn/20 text-warn border border-warn/40 glow-sm-warn",
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
      {icon && <span className="shrink-0 flex items-center justify-center">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

/** Pill de conexión ("● EN LÍNEA" / "● OFFLINE") — clicable. */
export function StatusPill({
  online,
  onClick,
  compact = false,
}: {
  online: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!online}
      title={online ? "Sincronizado en tiempo real — tocar para simular offline" : "Sin conexión — tocar para reconectar"}
      className={`flex items-center gap-1.5 ${
        compact ? "px-2 py-1" : "px-2.5 py-1.5"
      } rounded-full border transition-colors ${
        online
          ? "bg-ok-ink/60 border-ok-tint/40 text-ok-tint"
          : "bg-warn-ink/70 border-warn/40 text-warn"
      }`}
    >
      <StatusDot tone={online ? "ok" : "warn"} pulse />
      <span className="label-caps !text-[10px] tracking-widest">{online ? "EN LÍNEA" : "OFFLINE"}</span>
    </button>
  );
}
