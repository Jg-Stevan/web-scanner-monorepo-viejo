"use client";

/**
 * Onboarding de 4 pasos (primera ejecución) — estilo iOS.
 * Pantalla completa DENTRO del phone-frame: mientras el store tenga
 * `onboardingDone === false` (tras la hidratación), page.tsx renderiza
 * esta vista EN LUGAR de la app normal (sin BottomNav).
 *
 * · 4 pasos deslizables horizontalmente (AnimatePresence + swipe con drag="x").
 * · PageDots iOS: punto activo azul alargado (~20px), inactivos #C7C7CC.
 * · Botón primario azul "Continuar" → en el paso 4 pasa a "Comenzar a escanear".
 * · "Omitir" arriba a la derecha completa el onboarding directamente.
 * · Haptics en el último paso: navigator.vibrate([28,60,28]) si está disponible.
 * · Ilustraciones: solo iconos lucide 72-80px sobre círculo degradado azul.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Crop, FolderOpen, ScanSearch } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useScannerStore } from "@jg-stevan/scanner-core/store";
import { useIsShortLandscape } from "@/hooks/use-short-landscape";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  title: string;
  text: string;
  icon: LucideIcon;
}

const STEPS: OnboardingStep[] = [
  {
    title: "Digitaliza cualquier documento",
    text: "Convierte tu cámara en un escáner de alta precisión. Detección automática de bordes en tiempo real.",
    icon: ScanSearch,
  },
  {
    title: "Captura con confianza",
    text: "El marco azul detecta el documento y captura solo cuando es nítido. Multi-páginas en una sola sesión.",
    icon: Camera,
  },
  {
    title: "Edita y reconoce texto",
    text: "Recorta la perspectiva, aplica filtros de mejora y extrae el texto con OCR.",
    icon: Crop,
  },
  {
    title: "Organiza tu biblioteca",
    text: "Etiquetas, favoritos, búsqueda y exportación a PDF de toda tu biblioteca.",
    icon: FolderOpen,
  },
];

/** Umbral de swipe para cambiar de paso (px). */
const SWIPE_THRESHOLD = 50;
/** Haptics del último paso (patrón éxito). */
const HAPTIC_PATTERN = [28, 60, 28];

export default function OnboardingView() {
  const completeOnboarding = useScannerStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1); // 1 = avanza (slide desde la derecha)
  const lastStepRef = useRef(0);

  /* v13-post-33 — Landscape corto (≤520 px ∧ horizontal, hook v13-post-30
   *  con init perezoso — esta vista solo se monta tras `hydrated`, nunca
   *  en SSR): el contenido vertical de 317 px NO CABE en el área de
   *  ~136-226 px de un teléfono horizontal — medido en 568×320: círculo
   *  recortado 44 px por arriba y el párrafo ENTERO fuera del área visible
   *  (el overflow-hidden lo recorta sin scroll de rescate; también ocurre
   *  en 667×375 y 844×390 — r8 lo dio por «usable» porque el VLM no pilló
   *  el recorte, la medición dura de r10 sí). En landscape el espacio
   *  sobra a lo ANCHO: el paso pasa a FILA (ilustración + texto lado a
   *  lado, el clásico onboarding apaisado) con todo compacto. Portrait y
   *  desktop SIN cambios (columna original). */
  const short = useIsShortLandscape();

  const isLast = step === STEPS.length - 1;
  const next = useCallback(() => {
    setDir(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, []);
  const prev = useCallback(() => {
    setDir(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Haptics al LLEGAR al último paso (solo una vez por llegada real).
  useEffect(() => {
    if (step === STEPS.length - 1 && lastStepRef.current !== step) {
      try {
        navigator.vibrate?.(HAPTIC_PATTERN);
      } catch {
        /* sin Vibration API: silencio */
      }
    }
    lastStepRef.current = step;
  }, [step]);

  const finish = useCallback(() => {
    try {
      navigator.vibrate?.(HAPTIC_PATTERN);
    } catch {
      /* noop */
    }
    completeOnboarding();
  }, [completeOnboarding]);

  const onContinue = isLast ? finish : next;

  const Current = STEPS[step];

  return (
    <section
      aria-label="Bienvenida"
      className="ios-bg relative flex h-full min-h-0 w-full flex-col"
    >
      {/* ── Barra superior: app + Omitir ─────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-safe">
        <span className="text-[15px] font-semibold text-[#6d6d72] dark:text-[#8e8e93]">
          Escáner de Documentos
        </span>
        <button
          type="button"
          onClick={finish}
          className="-mr-1 rounded-lg px-2 py-1 text-[15px] font-normal text-[#007aff] transition-opacity active:opacity-50 outline-none"
        >
          Omitir
        </button>
      </header>

      {/* ── Contenido deslizable (paso actual) ───────────────────────── */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-8">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={step}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_, info) => {
              // Swipe izquierda → siguiente; derecha → anterior.
              if (info.offset.x < -SWIPE_THRESHOLD) next();
              else if (info.offset.x > SWIPE_THRESHOLD) prev();
            }}
            initial={{ opacity: 0, x: dir * 72 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -72 }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "flex w-full max-w-[320px] cursor-grab select-none flex-col items-center gap-7 text-center active:cursor-grabbing",
              short && "max-w-[480px] flex-row gap-6 text-left"
            )}
          >
            {/* Ilustración: icono lucide sobre círculo degradado azul */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.3, ease: "easeOut" }}
              className={cn(
                "flex h-[152px] w-[152px] shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#007AFF]/15 to-[#007AFF]/5",
                short && "h-[88px] w-[88px]"
              )}
              aria-hidden="true"
            >
              <Current.icon
                className={cn("h-[76px] w-[76px] text-[#007AFF]", short && "h-[44px] w-[44px]")}
                strokeWidth={1.6}
              />
            </motion.div>

            <div className="flex flex-col gap-3">
              <motion.h2
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.32, ease: "easeOut" }}
                className={cn(
                  "text-[24px] font-semibold leading-[1.2] tracking-[-0.01em] text-[#1c1c1e] dark:text-white",
                  short && "text-[19px]"
                )}
              >
                {Current.title}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.32, ease: "easeOut" }}
                className={cn(
                  "text-[15px] leading-[1.5] text-[#6d6d72] dark:text-[#8e8e93]",
                  short && "max-w-[340px] text-[13px] leading-[1.45]"
                )}
              >
                {Current.text}
              </motion.p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── PageDots iOS ─────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center gap-2 pb-6",
          short && "pb-2"
        )}
        role="tablist"
        aria-label="Pasos"
      >
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={`Paso ${i + 1} de ${STEPS.length}`}
            onClick={() => {
              setDir(i > step ? 1 : -1);
              setStep(i);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full outline-none transition-opacity active:opacity-50"
          >
            <span
              className={cn(
                "block rounded-full transition-all duration-300 ease-out",
                i === step
                  ? "h-[7px] w-5 bg-[#007AFF]"
                  : "h-[7px] w-[7px] bg-[#c7c7cc] dark:bg-[#545456]"
              )}
            />
          </button>
        ))}
      </div>

      {/* ── Acción principal ─────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pb-safe pt-1">
        <motion.button
          type="button"
          onClick={onContinue}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.12 }}
          className={cn(
            "flex h-12 w-full items-center justify-center rounded-xl bg-[#007AFF] text-[17px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.28)]",
            short && "h-11 text-[16px]"
          )}
        >
          {isLast ? "Comenzar a escanear" : "Continuar"}
        </motion.button>
        {/* Pista de swipe fuera en landscape corto: compite por el vertical
         *  que apenas existe — los puntos ya comunican que hay más pasos. */}
        {!short && (
          <p className="mt-3 text-center text-[12px] text-[#6d6d72] dark:text-[#8e8e93]">
            Desliza para explorar los pasos
          </p>
        )}
      </div>
    </section>
  );
}
