"use client";

/**
 * Proveedores de la app — tema claro/oscuro/sistema (next-themes).
 *  · attribute="class" → añade/quita .dark en <html> (Tailwind dark:).
 *  · defaultTheme="system" + enableSystem → sigue el SO del usuario.
 *  · disableTransitionOnChange → sin flash de transición al cambiar.
 *  · next-themes persiste la preferencia en localStorage (clave "theme")
 *    e inyecta un script pre-hidratación → suppressHydrationWarning en
 *    <html> es el patrón canónico (evita el mismatch de SSR).
 *
 * FIX v13-post (informe §4.2) — MotionConfig reducedMotion="user": el
 * bloque CSS de 13.2 cubre animaciones/transiciones CSS, pero
 * framer-motion anima por JS (vistas, banners, sheets) y las seguía
 * viendo un usuario con «Reducir movimiento» activo. Con esto TODAS las
 * animaciones de framer-motion bajo este árbol se desactivan solas cuando
 * el usuario lo pide en su SO (transform/layout a saltos instantáneos).
 */

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { ThemeColorSync } from "./ThemeColorSync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        {/* v13-post-9 — meta theme-color viva: sigue al tema RESUELTO
            (incluido el forzado por el usuario en Ajustes). */}
        <ThemeColorSync />
        {children}
      </MotionConfig>
    </ThemeProvider>
  );
}
