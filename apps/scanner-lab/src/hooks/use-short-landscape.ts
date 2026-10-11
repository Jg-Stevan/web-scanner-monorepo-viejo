"use client";

import { useEffect, useState } from "react";

/**
 * v13-post-30 — «Landscape corto» en vivo: ≤520 px de alto ∧ horizontal
 * (SE 1.ª gen 568×320, 667×375, 844×390…). Es la MISMA media query del
 * marco a 100 % (v13-post-26) y del editor compacto (v13-post-27), extraída
 * a hook para reutilizarla sin copiar el listener.
 *
 * OJO: la condición es por ORIENTACIÓN + alto, NO por `min-width: 640` —
 * el SE 1.ª gen en horizontal es 568 px de ancho: 568 < 640 y el
 * breakpoint `sm` de Tailwind NO dispara; con orientation queda cubierto
 * cualquier teléfono horizontal.
 *
 * v13-post-33 — init PEREZOSO sincrónico (typeof window + matchMedia en el
 * inicializador de useState, el mismo patrón del editor v13-post-27): el
 * primer render del cliente YA conoce la respuesta — sin flash de layout
 * grande→compacto en el montaje. Seguro para SSR/hidratación SOLO en
 * componentes que se montan del lado cliente (OnboardingView tras
 * `hydrated`, SettingsView tras interacción — NUNCA durante el render del
 * servidor); consumidores renderizados en SSR deben quedarse con el
 * estado inicial false y confiar en el efecto.
 *
 * matchMedia con listener en vivo: la rotación del dispositivo re-encaja
 * SIN recargar.
 */
export function useIsShortLandscape(): boolean {
  const [short, setShort] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-height: 520px) and (orientation: landscape)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px) and (orientation: landscape)");
    const sync = () => setShort(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return short;
}
