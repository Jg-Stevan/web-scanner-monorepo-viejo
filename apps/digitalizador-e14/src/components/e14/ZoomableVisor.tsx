"use client";

/**
 * ZOOMABLE VISOR (SERIE 1 · e14-SYNC-VISOR) — COPIA del subsistema F-ZOOM del
 * lab (apps/scanner-lab/src/components/scanner/EditorView.tsx): NO se
 * re-inventa; se copia la máquina de gestos PROBADA en táctil real (pinza ·
 * pan con clamps · doble toque · rueda · comparación por pulsación larga,
 * FIX v3/v6/v8 incluidos) y se re-veste con la estética Precision Monitor /
 * cyber-neón (ok-tint · ink · neon-ink · font-data; NADA de hex del lab tipo
 * #007aff/#1c1c1e). Encapsulado como componente PURO (mismo espíritu que
 * QuadEditor: cero store del core) para el visor fullscreen de ReviewView
 * (INSTRUCCIONES-e14-sync-visor REV. 2 §4 — CONTRATO del visor invariante por score V1–V6).
 *
 * Mapa de copia aplicado (lab EditorView.tsx → aquí):
 *   · Constantes ZOOM_MIN/MAX/DOUBLE_TAP + TAP_SLOP (L100–108) — LITERAL
 *     (SWIPE_MIN_PX/SWIPE_RUBBER EXCLUIDOS: e14 no tiene carrusel).
 *   · COMPARE_HOLD_MS (L119–120) — LITERAL.
 *   · Estado zoom: refs + useMotionValue + zoomPct + zoomPointers +
 *     zoomGesture + zoomDownAt + zoomLastTap (L419–441) — LITERAL
 *     (swipeAxisRef EXCLUIDO).
 *   · Comparación: comparing + timer (L415–417, L686–700) — LITERAL;
 *     page.original → prop compareSrc (solo se arma si existe).
 *   · Hint visible 6 s (L454–459) — LITERAL, texto re-vestido e14.
 *   · clampZoomPan (L708–728) — LITERAL (FIX v3 1.3: clamps contra el
 *     STAGE, no solo la imagen).
 *   · commitZoomScale / resetZoom (L730–743) — LITERAL; reset al ABRIR el
 *     visor (useEffect de montaje) en vez de al cambiar de página (L746–748).
 *   · Guard touchmove no pasivo del stage (L757–763, FIX v8 8.1) — LITERAL;
 *     deps [] (el stage monta/desmonta con el propio componente).
 *   · zoomRelToCenter (L777–781) · zoomAtPoint (L783–802) — LITERAL.
 *   · onStagePointerDown (L804–874) — STRIP del bloque DIAG perfProbe
 *     (L815–821, tooling del lab); guard closest("button") +
 *     setPointerCapture try/catch + arranque de compare intactos.
 *   · onStagePointerMove (L875–924) — pinch LITERAL; rama 1× ADAPTADA sin
 *     F-SWIPE: sin carrusel no hay decisión de eje — el umbral TAP_SLOP
 *     pasa a cancelar la comparación pendiente y retorna (a 1× no hay pan).
 *   · onStagePointerUp (L925–990) — LITERAL; bloque F-SWIPE (L954–971)
 *     EXCLUIDO (sin goToPage); el "candidato a doble toque" (cleanTap)
 *     además resuelve el CIERRE (decisión e14, ver abajo).
 *   · onStageWheel + listener nativo {passive:false} (L991–1003, L1010–1018)
 *     — LITERAL menos el DIAG perfProbe (B10: el onWheel de React es pasivo).
 *   · JSX stage (L2179–2193) — estructura LITERAL; el gradiente de fondo del
 *     lab (L2195–2202) se SUSTITUYE por el fondo bg-black/90 del modal e14
 *     (stage interno transparente). La fila de spinners/preview del lab no
 *     aplica: la foto del acta ya está en memoria (data URL).
 *   · JSX wrapper motion + <img> (L2215–2252) — LITERAL: FIX v3 (willChange
 *     solo durante el gesto) + FIX v6 (touch-none en wrapper Y en img);
 *     sombra del lab → tokens e14 (shadow-2xl shadow-black).
 *   · JSX overlay de comparación (L2253–2278) — re-vestido: pill
 *     bg-white/95 · #1c1c1e → tokens ink/neon-ink, Eye icono propio de e14.
 *   · JSX chip de zoom % + Restablecer (L2285–2307) — re-vestido:
 *     #007aff → ok-tint, tipografía font-data.
 *   · JSX hint «Pellizca para ampliar…» (L2309–2316) — re-vestido e14.
 *
 * ZOOM-INLINE v1 (INSTRUCCIONES-e14-zoom-inline §3) — MODO `card`: el MISMO
 * componente monta inline en la tarjeta de ReviewView. La máquina de gestos
 * (pinza/pan/clamps/rueda/FIX v3-v6-v8) se REUTILIZA INTACTA — la geometría
 * es agnóstica al contenedor. Solo cambian: techo del zoom (ZOOM_MAX_CARD=3),
 * stage relativo con clip de esquinas de la tarjeta, chrome FUERA (chip %,
 * hint y comparación NO se montan — la tarjeta queda limpia; el fullscreen
 * conserva los suyos) y la semántica del TAP: a 1× abre fullscreen DIFERIDO
 * DOBLE_TOQUE_MS (la ventana del doble toque — si llega el 2º toque, es zoom
 * y NO abre: mismo trade-off del cierre diferido del modal, estándar Fotos de
 * iOS); ampliado, el tap vuelve a 1× (también diferido por la misma ventana).
 * El modal fullscreen y su comportamiento quedan byte-a-byte.
 *
 * DECISIÓN de cierre por toque (§4.0 del instructivo — documentada):
 * el modal e14 cerraba con tap en cualquier lado; con doble-toque=2.5× ese
 * cierre directo mataría el zoom (el 1er toque cerraría). Regla adoptada:
 *   · tap sobre el ÁREA NEGRA del stage (fuera de la imagen) = tap-fuera →
 *     cierra INMEDIATO (como «tap-fuera cierra» del instructivo);
 *   · tap LIMPIO sobre la IMAGEN a 1× y sin arrastre → cierra «como hoy»
 *     PERO diferido 320 ms (la ventana del doble toque del lab): si llega
 *     un 2º toque, es doble-toque (zoom 2.5×) y el cierre se cancela;
 *   · tap sobre un BOTÓN interno (chip Restablecer) → nunca cierra (guard
 *     closest("button") del lab, conservado);
 *   · ampliado (>1×), tras arrastre/pinza o pulsación larga (comparación,
 *     ≥350 ms > ventana de 280 ms del cleanTap) → el toque NO cierra;
 *   · Esc cierra (efecto del modal en ReviewView, intacto).
 * Un pointerdown nuevo cancela el cierre diferido pendiente; el latch
 * post-pincha (rama «un dedo sigue») trata el dedo restante como
 * interactivo para que levantar una pinza nunca cierre el visor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { EyeIcon } from "./icons";

/** F-ZOOM — límites del zoom del visor (mismos que el lab). */
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
/** ZOOM-INLINE — techo del zoom en la TARJETA (1×–3×; el modal conserva 6×). */
const ZOOM_MAX_CARD = 3;
const ZOOM_DOUBLE_TAP = 2.5;
/** Umbral de movimiento (px) para distinguir arrastre de toque (lab). */
const TAP_SLOP = 8;
/** Mantener pulsado el visor (ms) antes de mostrar el original (lab L120). */
const COMPARE_HOLD_MS = 350;
/** Ventana ÚNICA del doble toque Y del tap diferido — UNA fuente de verdad
 *  (ZOOM-INLINE §3.3) para zoomLastTap, el cierre del modal (§4.0) y la
 *  apertura del card (tap simple a 1×). Antes: CLOSE_DEFER_MS + literal 320
 *  en el doble toque. */
const DOBLE_TOQUE_MS = 320;

export interface ZoomableVisorProps {
  /** Foto visible (procesada o respaldo original — ReviewView L259). */
  src: string;
  alt: string;
  /** Acta original — SOLO si difiere de src (F-COMPARE por pulsación).
   *  Se ignora en modo card (la comparación vive SOLO en fullscreen). */
  compareSrc?: string;
  /** ZOOM-INLINE — "modal" (default: fullscreen, cierre por toque §4.0) o
   *  "card" (inline en la tarjeta de ReviewView, sin chrome). */
  mode?: "modal" | "card";
  /** SOLO card: abrir pantalla completa (tap simple a 1×, diferido
   *  DOBLE_TOQUE_MS para no matar el doble toque). */
  onOpenFullscreen?: () => void;
  /** SOLO modal: cierre del fullscreen (tap-fuera/imagen/Esc en ReviewView). */
  onClose?: () => void;
}

export function ZoomableVisor({
  src,
  alt,
  compareSrc,
  mode = "modal",
  onOpenFullscreen,
  onClose,
}: ZoomableVisorProps) {
  const esCard = mode === "card";
  // ── F-ZOOM — zoom del visor (pinza · pan · doble toque · rueda) ────────
  const zoomStageRef = useRef<HTMLDivElement>(null);
  const zoomWrapRef = useRef<HTMLDivElement>(null);
  const zoomImgRef = useRef<HTMLImageElement>(null);
  const zoomScale = useMotionValue(1);
  const zoomX = useMotionValue(0);
  const zoomY = useMotionValue(0);
  /** % del zoom para el chip flotante (estado discreto, no por frame). */
  const [zoomPct, setZoomPct] = useState(100);
  const zoomPointers = useRef(new Map<number, { x: number; y: number }>());
  const zoomGesture = useRef<
    | null
    | {
        type: "pan" | "pinch";
        startScale: number;
        startDist: number;
        startX: number;
        startY: number;
        midX: number;
        midY: number;
      }
  >(null);
  const zoomDownAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const zoomLastTap = useRef(0);

  // ── e14 — «tap diferido» (mecanismo ÚNICO, ver cabecera) ───────────────
  /** Timer del tap diferido: modal → cierre por tap a 1× sobre la imagen
   *  (§4.0); card → tap a 1× abre fullscreen · tap ampliado vuelve a 1×
   *  (ZOOM-INLINE §3.7). Un pointerdown nuevo SIEMPRE cancela lo pendiente. */
  const deferredTapRef = useRef<number | null>(null);
  const cancelDeferredTap = useCallback(() => {
    if (deferredTapRef.current !== null) {
      window.clearTimeout(deferredTapRef.current);
      deferredTapRef.current = null;
    }
  }, []);
  /** Dónde nació el toque (pointerdown) — decide el cierre en pointerup. */
  const downOnImgRef = useRef(false);
  const downOnBtnRef = useRef(false);

  // ── Comparación antes/después (mantener pulsado el visor a 1×) ──────────
  const [comparing, setComparing] = useState(false);
  const compareTimer = useRef<number | null>(null);

  /** Hint de zoom: visible ~6 s al montar (didáctico, luego se va solo). */
  const [zoomHintVisible, setZoomHintVisible] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setZoomHintVisible(false), 6000);
    return () => window.clearTimeout(t);
  }, []);

  // ── Comparación antes/después (lab L686–700) ───────────────────────────
  const startCompareTimer = useCallback(() => {
    if (compareTimer.current !== null) window.clearTimeout(compareTimer.current);
    compareTimer.current = window.setTimeout(() => {
      compareTimer.current = null;
      setComparing(true);
      navigator.vibrate?.(18);
    }, COMPARE_HOLD_MS);
  }, []);
  const endCompare = useCallback(() => {
    if (compareTimer.current !== null) {
      window.clearTimeout(compareTimer.current);
      compareTimer.current = null;
    }
    setComparing(false);
  }, []);
  useEffect(() => () => endCompare(), [endCompare]);
  useEffect(() => () => cancelDeferredTap(), [cancelDeferredTap]);

  /* ── F-ZOOM — gestos de ampliación del visor ──────────────────────────
   * Pinza (2 dedos) 1×–6× anclada al punto medio · pan con 1 dedo ampliado
   * (acotado a los bordes de la IMAGEN) · doble toque alterna 1× ↔ 2,5×
   * centrado en el punto · rueda del ratón en escritorio. El chip flotante
   * muestra el %. */
  const clampZoomPan = useCallback(() => {
    const s = zoomScale.get();
    const img = zoomImgRef.current;
    // FIX v3 (1.3): límites contra el STAGE, no solo contra la imagen — la
    // fórmula vieja ((imgW × (s−1))/2) permitía sobre-paneo cuando la
    // imagen era más pequeña que el stage en algún eje (huecos negros,
    // imagen «cortada» flotando). (imgW × s − stageW)/2 clava el borde de
    // la imagen al del stage cuando se tocan.
    const stage = zoomStageRef.current;
    let bx = 0;
    let by = 0;
    if (img && stage && s > 1) {
      bx = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
      by = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
    }
    if (zoomX.get() > bx) zoomX.set(bx);
    if (zoomX.get() < -bx) zoomX.set(-bx);
    if (zoomY.get() > by) zoomY.set(by);
    if (zoomY.get() < -by) zoomY.set(-by);
  }, [zoomScale, zoomX, zoomY, zoomImgRef]);

  const commitZoomScale = useCallback(
    (next: number) => {
      zoomScale.set(next);
      setZoomPct(Math.round(next * 100));
    },
    [zoomScale]
  );

  const resetZoom = useCallback(() => {
    zoomScale.set(1);
    zoomX.set(0);
    zoomY.set(0);
    setZoomPct(100);
  }, [zoomScale, zoomX, zoomY]);

  // e14: el zoom se reinicia al ABRIR el visor (montaje, modal — como Fotos
  // de iOS) y al CAMBIAR de acta (ZOOM-INLINE §3.8: src cambia en la tarjeta
  // — un solo efecto cubre ambos). En el lab era al cambiar de página
  // (L746–748), aquí no hay páginas.
  useEffect(() => {
    resetZoom();
  }, [src, resetZoom]);

  // FIX v8 (8.1) — cinturón y tirantes: WebKit puede quedar con el gesto
  // (rubber-band residual / heurística de doble toque) y disparar
  // pointercancel a mitad del pan con zoom aunque toda la cadena tenga
  // touch-none. Este listener no pasivo lo mata. Dentro del stage no hay
  // nada scrollable → preventDefault es seguro. Deps []: el stage vive lo
  // mismo que el componente (el modal monta/desmonta entero).
  useEffect(() => {
    const stage = zoomStageRef.current;
    if (!stage) return;
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    stage.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => stage.removeEventListener("touchmove", onTouchMove);
  }, []);

  /** Coordenadas del puntero relativas al CENTRO del stage (ancla de zoom). */
  const zoomRelToCenter = useCallback((cx: number, cy: number) => {
    const rect = zoomStageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: cx - (rect.left + rect.width / 2), y: cy - (rect.top + rect.height / 2) };
  }, []);

  /** Escala a `next` manteniendo bajo el punto `px,py` (relativo al centro)
   *  el mismo contenido que había (fórmula clásica de zoom anclado).
   *  ZOOM-INLINE §3.2: techo efectivo — 3× en la tarjeta (ZOOM_MAX_CARD), 6×
   *  en el modal (ZOOM_MAX). */
  const zoomAtPoint = useCallback(
    (px: number, py: number, next: number) => {
      const s = zoomScale.get();
      const clamped = Math.min(esCard ? ZOOM_MAX_CARD : ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (clamped === s) return;
      // Punto de contenido (coords a escala 1) bajo el ancla:
      const cx = (px - zoomX.get()) / s;
      const cy = (py - zoomY.get()) / s;
      commitZoomScale(clamped);
      zoomX.set(px - cx * clamped);
      zoomY.set(py - cy * clamped);
      if (clamped === ZOOM_MIN) {
        zoomX.set(0);
        zoomY.set(0);
      } else {
        clampZoomPan();
      }
    },
    [zoomScale, zoomX, zoomY, commitZoomScale, clampZoomPan, esCard]
  );

  const onStagePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = zoomStageRef.current;
      if (!el) return;
      // e14: un toque nuevo anula el tap diferido pendiente (modal: tap suelto
      // a 1× esperando la ventana del doble toque; card: apertura/reset
      // pendiente) — simétrico, mismo mecanismo.
      cancelDeferredTap();
      // F-NAV (lección de la presentación): solo capturar cuando el down cae
      // en el propio stage — si cae en un hijo interactivo (botón/chip) su
      // click debe vivir. B1: el guard anterior (target === currentTarget)
      // NUNCA se cumplía → ni setPointerCapture ni compare funcionaban.
      // ZOOM-INLINE §3.6: en card NO hay hijos interactivos → captura SIEMPRE
      // (onInteractive = false; el guard closest("button") es del modal).
      const onInteractive = esCard
        ? false
        : !!(e.target as HTMLElement | null)?.closest?.("button");
      // e14: memo de dónde nació el toque — el pointerup decide el cierre.
      downOnBtnRef.current = onInteractive;
      downOnImgRef.current = !!(e.target as HTMLElement | null)?.closest?.("img");
      if (!onInteractive) {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* algunos navegadores lanzan si el puntero ya se soltó */
        }
      }
      zoomPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zoomPointers.current.size === 2) {
        // Inicio de pinza: cancela la comparación (gesto de 1 dedo).
        endCompare();
        const [a, b] = [...zoomPointers.current.values()];
        const mid = zoomRelToCenter((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        zoomGesture.current = {
          type: "pinch",
          startScale: zoomScale.get(),
          startDist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: mid.x,
          midY: mid.y,
        };
      } else if (zoomPointers.current.size === 1) {
        zoomDownAt.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        zoomGesture.current = {
          type: "pan",
          startScale: zoomScale.get(),
          startDist: 0,
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: 0,
          midY: 0,
        };
        // F-ZOOM: a escala 1× el "mantener pulsado" compara ORIGINAL vs
        // procesado (como Fotos de iOS); ampliado, el mismo dedo hace PAN.
        // B1: activar salvo que el toque sea sobre un botón. e14: además
        // SOLO si hay original que mostrar (compareSrc). ZOOM-INLINE §3.5:
        // en card la comparación NO corre (la tarjeta queda limpia — el
        // «comparar original» es SOLO de fullscreen).
        if (
          !esCard &&
          zoomScale.get() <= 1.01 &&
          (e.button === 0 || e.pointerType !== "mouse") &&
          !onInteractive &&
          compareSrc != null
        ) {
          startCompareTimer();
        }
      }
    },
    [zoomRelToCenter, endCompare, startCompareTimer, zoomScale, zoomX, zoomY, compareSrc, cancelDeferredTap, esCard]
  );

  const onStagePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!zoomPointers.current.has(e.pointerId)) return;
      zoomPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = zoomGesture.current;
      if (!g) return;
      if (g.type === "pinch" && zoomPointers.current.size >= 2) {
        const [a, b] = [...zoomPointers.current.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (g.startDist > 4) {
          const next = g.startScale * (dist / g.startDist);
          zoomAtPoint(g.midX, g.midY, next);
        }
      } else if (g.type === "pan") {
        // e14 (sin F-SWIPE): a 1× el arrastre no panea ni navega — la
        // decisión de eje del lab colapsa a cancelar la comparación al
        // pasar el umbral TAP_SLOP y retornar (el vertical del lab tampoco
        // hacía nada; el horizontal era solo carrusel).
        if (zoomScale.get() <= 1.01) {
          const down0 = zoomDownAt.current;
          if (!down0) return;
          if (Math.hypot(e.clientX - down0.x, e.clientY - down0.y) > TAP_SLOP) {
            endCompare();
          }
          return;
        }
        const down = zoomDownAt.current;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP) {
          zoomGesture.current = { ...g, type: "pan", startX: g.startX, startY: g.startY };
        }
        zoomX.set(g.startX + (e.clientX - (down?.x ?? e.clientX)));
        zoomY.set(g.startY + (e.clientY - (down?.y ?? e.clientY)));
        clampZoomPan();
      }
    },
    [zoomAtPoint, clampZoomPan, zoomScale, zoomX, zoomY, endCompare]
  );

  const onStagePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasPinch = zoomGesture.current?.type === "pinch";
      zoomPointers.current.delete(e.pointerId);
      if (zoomPointers.current.size === 0) {
        const down = zoomDownAt.current;
        const g = zoomGesture.current;
        zoomDownAt.current = null;
        zoomGesture.current = null;
        endCompare();
        clampZoomPan();
        // ¿Toque limpio (sin arrastre)? → candidato a doble toque.
        const cleanTap =
          down &&
          g?.type === "pan" &&
          Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_SLOP &&
          performance.now() - down.t < 280;
        if (cleanTap && !wasPinch) {
          const now = performance.now();
          if (now - zoomLastTap.current < DOBLE_TOQUE_MS) {
            // Doble toque: alterna 1× ↔ 2,5× centrado en el punto.
            zoomLastTap.current = 0;
            // e14: era el 2º toque — el tap diferido del 1º se cancela
            // (modal: el cierre; card: la apertura/reset).
            cancelDeferredTap();
            const p = zoomRelToCenter(e.clientX, e.clientY);
            if (zoomScale.get() > 1.01) resetZoom();
            else zoomAtPoint(p.x, p.y, ZOOM_DOUBLE_TAP);
          } else if (esCard) {
            // ZOOM-INLINE §3.7 — semántica del TAP en la TARJETA (tap
            // diferido, mismo patrón del cierre del modal): a 1× abre
            // fullscreen tras DOBLE_TOQUE_MS (si llega el 2º toque, el doble
            // toque lo cancela y hace zoom — NO abre); ampliado, vuelve a 1×
            // tras la MISMA ventana (tampoco abre).
            zoomLastTap.current = now;
            cancelDeferredTap();
            deferredTapRef.current = window.setTimeout(() => {
              deferredTapRef.current = null;
              if (zoomScale.get() > 1.01) resetZoom();
              else onOpenFullscreen?.();
            }, DOBLE_TOQUE_MS);
          } else {
            zoomLastTap.current = now;
            // e14 — DECISIÓN de cierre (§4.0, ver cabecera): tap limpio a
            // 1×. Sobre la IMAGEN: cierre diferido DOBLE_TOQUE_MS (protege
            // el doble toque). Sobre el ÁREA NEGRA (tap-fuera): inmediato.
            // Sobre un botón interno o ampliado (>1×): nunca cierra.
            if (!downOnBtnRef.current && zoomScale.get() <= 1.01) {
              if (downOnImgRef.current) {
                cancelDeferredTap();
                deferredTapRef.current = window.setTimeout(() => {
                  deferredTapRef.current = null;
                  onClose?.();
                }, DOBLE_TOQUE_MS);
              } else {
                onClose?.();
              }
            }
          }
        }
        // (F-SWIPE excluido: e14 no tiene carrusel ni goToPage.)
      } else if (zoomPointers.current.size === 1) {
        // Un dedo sigue en pantalla tras la pincha → pasa a pan desde aquí.
        // e14: se marca como "interactivo" para que levantar la pinza no
        // dispare el cierre por toque (latch post-pincha).
        const [a] = [...zoomPointers.current.values()];
        downOnBtnRef.current = true;
        zoomGesture.current = {
          type: "pan",
          startScale: zoomScale.get(),
          startDist: 0,
          startX: zoomX.get(),
          startY: zoomY.get(),
          midX: 0,
          midY: 0,
        };
        zoomDownAt.current = a ? { x: a.x, y: a.y, t: performance.now() } : null;
      }
    },
    [clampZoomPan, endCompare, zoomRelToCenter, zoomAtPoint, resetZoom, zoomScale, zoomX, zoomY, onClose, cancelDeferredTap, esCard, onOpenFullscreen]
  );

  /** Rueda del ratón (escritorio): zoom anclado al cursor. */
  const onStageWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      const p = zoomRelToCenter(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAtPoint(p.x, p.y, zoomScale.get() * factor);
    },
    [zoomRelToCenter, zoomAtPoint, zoomScale]
  );

  // B10: el `onWheel` de React es PASIVO (preventDefault = no-op) y el zoom
  // del navegador se colaba detrás del stage. Listener nativo {passive:false}.
  useEffect(() => {
    const el = zoomStageRef.current;
    if (!el) return;
    el.addEventListener("wheel", onStageWheel, { passive: false });
    return () => el.removeEventListener("wheel", onStageWheel);
  }, [onStageWheel]);

  const zoomed = zoomPct > 101;

  return (
    <div
      ref={zoomStageRef}
      /* ZOOM-INLINE §3.4: stage condicional — modal: absolute inset-0 (fondo
       * negro del dialog, px-3); card: relativo h/w completo con clip de
       * esquinas (rounded-[14px]) — la imagen ampliada NO se sale de la
       * tarjeta (el clip lo pone el stage). */
      className={
        esCard
          ? "relative flex h-full w-full touch-none select-none items-center justify-center overflow-hidden rounded-[14px]"
          : "absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden px-3"
      }
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      /* FIX v8 (8.2): leave SOLO para mouse — iOS dispara pointerleave espurios
       * a mitad del pan (recomposite del chip de zoom / capa will-change) y el
       * handler lo interpretaba como fin de gesto, matando el paneo. */
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onStagePointerUp(e);
      }}
      onPointerCancel={onStagePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <motion.div
        /* ZOOM-INLINE §3.9: SIN animación de entrada en card — la foto debe
         * aparecer al instante; el modal conserva su fade. */
        initial={esCard ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
        className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden"
      >
        {/* Capa de zoom: scale/x/y por motion values. FIX v3 (1.5):
            will-change SOLO durante el gesto — una capa GPU con will-change
            permanente puede quedar rasterizada a baja resolución en iOS
            Safari (imagen suave/borrosa al ampliar). A 1× la capa se
            des-promociona. */}
        <motion.div
          ref={zoomWrapRef}
          style={{ scale: zoomScale, x: zoomX, y: zoomY, willChange: zoomed ? "transform" : "auto" }}
          /* FIX v6 (6.3): touch-none también en el WRAPPER del pan —
           * WebKit solo respeta el touch-action del elemento donde NACE el
           * toque, no el de los ancestros. */
          className="flex h-full w-full touch-none items-center justify-center"
        >
          <img
            ref={zoomImgRef}
            src={src}
            alt={alt}
            draggable={false}
            /* FIX v6 (6.3): el toque nace en el <img> — sin su touch-none,
             * Safari dispara pointercancel al iniciar el arrastre y el paneo
             * con zoom no responde al dedo. */
            /* ZOOM-INLINE §3.10: en card SIN rounded ni sombra — el clip y la
             * estética los pone la tarjeta; el modal conserva los suyos. */
            className={
              esCard
                ? "max-h-full max-w-full touch-none select-none object-contain"
                : "max-h-full max-w-full touch-none select-none rounded-[6px] object-contain shadow-2xl shadow-black"
            }
          />
          {/* Comparación antes/después: el ORIGINAL mientras se mantiene pulsado.
              ZOOM-INLINE §3.5: SOLO fullscreen — en card NO se monta. */}
          {!esCard && (
            <AnimatePresence>
              {comparing && compareSrc && (
              <motion.div
                key="review-compare"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="absolute inset-0 z-20 flex items-center justify-center"
                aria-hidden="true"
              >
                <img
                  src={compareSrc}
                  alt=""
                  draggable={false}
                  /* FIX v6 (6.3): mismo touch-none — al comparar, ESTE img
                   * cubre al del visor y el toque nace en él. */
                  className="max-h-full max-w-full touch-none select-none rounded-[6px] object-contain shadow-2xl shadow-black"
                />
                {/* Pill re-vestida e14: bg-white/95 · #1c1c1e del lab →
                    tokens ink (blanco) / neon-ink (negro). */}
                <span className="absolute left-1/2 top-3 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/95 px-3 py-1 font-data text-[10px] font-bold uppercase tracking-[0.14em] text-neon-ink shadow-lg shadow-black/80 backdrop-blur-md">
                  <EyeIcon className="h-3.5 w-3.5" />
                  ORIGINAL
                </span>
              </motion.div>
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </motion.div>

      {/* F-ZOOM — chip de zoom con % y botón de reinicio (patrón Fotos).
          Re-vestido e14: #007aff → ok-tint, font-data.
          ZOOM-INLINE §3.5: SOLO fullscreen — en card NO se monta (sin chip %
          ni RESTABLECER en la tarjeta). */}
      {!esCard && (
        <AnimatePresence>
          {zoomed && (
            <motion.div
              key="zoom-chip"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.94 }}
              transition={{ duration: 0.18 }}
              className="absolute right-3 top-3 z-30"
            >
              <button
                type="button"
                aria-label="Restablecer el zoom"
                onClick={resetZoom}
                className="flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1.5 font-data text-[10px] font-bold uppercase tracking-[0.1em] tabular-nums text-ink backdrop-blur-md transition-transform active:scale-95"
              >
                {zoomPct}%
                <span className="text-ink-dim" aria-hidden="true">·</span>
                <span className="text-ok-tint">RESTABLECER</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Hint de zoom (una vez por montaje — 6 s, texto re-vestido e14).
          ZOOM-INLINE §3.5: SOLO fullscreen — en card NO se monta. */}
      {!esCard && !zoomed && zoomHintVisible && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-6">
          <span className="rounded-full bg-black/45 px-3 py-1.5 font-data text-[9px] font-bold uppercase tracking-[0.16em] text-ink-dim backdrop-blur-md">
            {compareSrc
              ? "PELLIZCA PARA AMPLIAR · MANTÉN PULSADO PARA VER EL ORIGINAL"
              : "PELLIZCA PARA AMPLIAR · DOBLE TOQUE = 2.5×"}
          </span>
        </div>
      )}
    </div>
  );
}
