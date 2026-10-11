"use client";

/**
 * v13-post-9 — theme-color dinámica (compatibilidad de dispositivos).
 *
 * El `viewport.themeColor` de layout.tsx declara un PAR de metas con
 * `media="(prefers-color-scheme: …)"` (uno claro, uno oscuro) — correcto
 * sin JS y al arrancar. Pero cuando el usuario FUERZA un tema en
 * Ajustes › Apariencia (next-themes con `attribute="class"`), la media
 * query deja de coincidir con lo que la app está mostrando: la barra del
 * navegador (Android Chrome/Samsung/Edge y la barra de título de la PWA
 * instalada) queda con el color del esquema del SO, no del elegido.
 *
 * Este componente sincroniza TODAS las metas theme-color con el tema
 * RESUELTO en vivo:
 *  · Tema «Sistema» → resolvedTheme coincide con la media query (no-op).
 *  · Tema forzado   → pinta las metas con el color real de la app.
 *
 * iOS Safari ignora theme-color (tiñe la barra con el fondo de la página
 * desde iOS 15), así que ahí no cambia nada; Android y las PWAs de
 * escritorio sí lo respetan. Colores = superficies dominantes de la app
 * (#f2f2f7 claro / #000000 oscuro), mismo look que la cabecera iOS.
 */

import { useEffect } from "react";
import { useTheme } from "next-themes";

const LIGHT = "#f2f2f7";
const DARK = "#000000";

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // resolvedTheme es undefined solo antes de hidratar: en ese caso las
    // metas estáticas de la media query siguen mandando (arranque correcto).
    if (!resolvedTheme) return;
    const color = resolvedTheme === "dark" ? DARK : LIGHT;
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color));
  }, [resolvedTheme]);

  return null;
}
