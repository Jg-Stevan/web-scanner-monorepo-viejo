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
 * matchMedia con listener en vivo: la rotación del dispositivo re-encaja
 * SIN recargar. Seguro para hidratación: el estado inicial (false) coincide
 * con el render del servidor — este hook solo se consume en vistas que se
 * montan del lado cliente (Ajustes y compañía viven tras la interacción,
 * nunca en el SSR de la página).
 */
export function useIsShortLandscape(): boolean {
  const [short, setShort] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-height: 520px) and (orientation: landscape)");
    const sync = () => setShort(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return short;
}
