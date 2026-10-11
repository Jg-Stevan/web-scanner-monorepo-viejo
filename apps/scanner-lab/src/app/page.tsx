"use client";

/**
 * Shell principal del escáner de documentos (estilo iOS).
 * Renderiza la vista activa del store dentro de un marco tipo teléfono
 * centrado en desktop. La barra inferior de navegación solo aparece en
 * Biblioteca y Ajustes (Cámara/Editor usan sus propias barras).
 * F-NOVIEW: la 3ª interfaz (Digitalización) desapareció — los documentos
 * guardados se abren en el propio Editor (modo revisión, como Adobe Scan).
 * Transición entre vistas: deslizamiento direccional sutil (push/pop de iOS).
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useScannerStore, ONBOARDING_STORAGE_KEY } from "@jg-stevan/scanner-core/store";
import type { ScannerView } from "@jg-stevan/scanner-core/types";
import {
  PROCESSED_MAX_LONG_SIDE,
  warmUpScannerWorker,
  getScannerWorker,
} from "@jg-stevan/scanner-core/image-processor";
import LibraryView from "@/components/scanner/LibraryView";
import CameraView from "@/components/scanner/CameraView";
import EditorView from "@/components/scanner/EditorView";
import SettingsView from "@/components/scanner/SettingsView";
import BottomNav from "@/components/scanner/BottomNav";
import OnboardingView from "@/components/scanner/OnboardingView";
import { installCrashReporter } from "@/lib/crash-reporter";

// EXPERIMENTO v11 — crash reporter (SOLO observación): instalar lo más
// temprano posible, ANTES del primer render, para capturar errores desde
// el arranque. Nada de preventDefault/reintentos/fetch — el error sigue
// apareciendo en consola normalmente; el registro vive en el anillo
// localStorage "scannerlab_crash_ring" + window.__crashLog y el banner
// rojo pide captura de pantalla al dueño.
if (typeof window !== "undefined") {
  installCrashReporter();
}

/** Profundidad de navegación (para decidir dirección del slide). */
const VIEW_RANK: Record<ScannerView, number> = {
  library: 0,
  settings: 1,
  camera: 2,
  editor: 3,
};

export default function Home() {
  const view = useScannerStore((s) => s.view);
  const hydrated = useScannerStore((s) => s.hydrated);
  const onboardingDone = useScannerStore((s) => s.onboardingDone);

  // Onboarding de primera ejecución: el store arranca SIEMPRE con false
  // (server + primer render del cliente — sin mismatch de hidratación);
  // tras montar se lee la marca persistida y, una vez hidratado el store,
  // el onboarding ocupa el frame EN LUGAR de la app (sin BottomNav).
  const showOnboarding = hydrated && !onboardingDone;

  // Vista previa para la dirección de la transición (ajuste de estado en
  // fase de render — patrón oficial de React, sin leer refs en render).
  const [viewMemo, setViewMemo] = useState<{ view: ScannerView; prev: ScannerView }>({
    view,
    prev: view,
  });
  if (viewMemo.view !== view) {
    setViewMemo({ view, prev: viewMemo.view });
  }

  // Precalienta el pipeline de precisión (worker + OpenCV.js self-hosted)
  // y hidrata documentos + ajustes desde IndexedDB/localStorage (§8 — la
  // biblioteca sobrevive al recargar; en instalación nueva conservan mocks).
  useEffect(() => {
    // Marca de onboarding (lectura síncrona ANTES de hidratar): si ya se
    // completó en una ejecución anterior, el flag se activa aquí — la
    // transición a la app es invisible para visitas repetidas.
    try {
      if (localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1") {
        useScannerStore.setState({ onboardingDone: true });
      }
    } catch {
      /* sin localStorage (privada/SSR): el onboarding vuelve a mostrarse */
    }
    void useScannerStore.getState().hydrateFromStorage();

    // Limpieza one-liner de la key huérfana del benchmark viejo (inofensiva
    // si se deja, pero mejor no acumular basura en localStorage).
    try {
      localStorage.removeItem("escaner-device-cap-v1");
    } catch {
      /* privada/SSR: no pasa nada */
    }
  }, []);

  // FIX v12 (12.2b) — PRECALENTAMIENTO del detector EN IDLE: cargar el
  // OpenCV WASM (1–3 s en gama baja) durante el arranque compite con la
  // hidratación y el primer render. Se difiere a requestIdleCallback
  // (fallback setTimeout 1500), UNA vez por sesión, silencioso si falla.
  // Reutiliza la inicialización existente de detector-client
  // (warmUpScannerWorker + setWarpCap — nunca un worker duplicado); si el
  // usuario abre la cámara antes, el propio loop arranca el worker y esto
  // es un no-op. Telemetría QA: window.__prewarm = { ok, ms }.
  useEffect(() => {
    const w = window as unknown as {
      __prewarm?: { ok: boolean; ms: number };
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let started = false;
    let handle = 0;
    let usedIdle = false;
    const start = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      try {
        warmUpScannerWorker();
        const c = getScannerWorker();
        // FIX v3 (fix-editor-quality): tope único del warp (su default ya ES
        // 4032 — llamada explícita, ahora tras el spawn del worker).
        c?.setWarpCap(PROCESSED_MAX_LONG_SIDE);
        void c
          ?.waitReady()
          .then((ok) => {
            w.__prewarm = { ok, ms: Math.round(performance.now() - t0) };
          })
          .catch(() => {
            w.__prewarm = { ok: false, ms: Math.round(performance.now() - t0) };
          });
      } catch {
        w.__prewarm = { ok: false, ms: Math.round(performance.now() - t0) };
      }
    };
    if (typeof w.requestIdleCallback === "function") {
      usedIdle = true;
      handle = w.requestIdleCallback(start, { timeout: 2500 });
    } else {
      handle = window.setTimeout(start, 1500);
    }
    return () => {
      if (!started) {
        if (usedIdle && typeof w.cancelIdleCallback === "function") {
          w.cancelIdleCallback(handle);
        } else {
          window.clearTimeout(handle);
        }
      }
    };
  }, []);

  // EXPERIMENTO v11 — sincroniza la vista activa en window.__scannerView
  // para que el crash reporter sepa DÓNDE crasheó (library/camera/editor/…).
  useEffect(() => {
    (window as unknown as { __scannerView?: string }).__scannerView = view;
  }, [view]);

  // Previene el scroll del body en vistas de cámara (negro) para simular app nativa
  useEffect(() => {
    const black = view === "camera" || view === "editor";
    document.body.style.overflow = black ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [view]);

  // Atajo global de escritorio: Escape = atrás contextual (patrón iOS).
  // Se ignora cuando un dialog/menú/hoja nativa está abierto (Radix los
  // cierra por sí mismo) — incluida la presentación (role=dialog propio).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return;
      const s = useScannerStore.getState();
      if (s.view === "settings" || s.view === "camera") {
        e.preventDefault();
        s.setView("library");
      } else if (s.view === "editor") {
        e.preventDefault();
        // F-NOVIEW: en modo revisión de documento el Escape fusiona y sale
        // a la biblioteca (auto-guardado); en sesión de captura vuelve a la cámara.
        if (s.reviewDocId) void s.exitReviewToLibrary();
        else s.setView("camera");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Dirección de la transición: hacia adelante (slide desde la derecha)
  // al navegar en profundidad, hacia atrás (slide desde la izquierda) al volver.
  const direction = VIEW_RANK[view] >= VIEW_RANK[viewMemo.prev] ? 1 : -1;

  const fullBleed = view === "camera" || view === "editor";

  return (
    // suppressHydrationWarning en los contenedores del marco: las extensiones
    // de navegador inyectan atributos data-* antes de que React hidrate
    // (p.ej. data-protocompass-form de asistentes de formularios) → mismatch
    // SSR/cliente cosmético que disparaba el overlay de hidratación.
    <div
      className="flex min-h-dvh w-full items-stretch justify-center bg-[#e9e9ee] dark:bg-[#111111] sm:items-center sm:py-6"
      suppressHydrationWarning
    >
      <div
        id="app-phone"
        suppressHydrationWarning
        className={[
          "relative flex w-full flex-col overflow-hidden bg-[#f2f2f7] dark:bg-black",
          // F-MOBILE: dvh sigue la barra dinámica del navegador (svh dejaba
          // un hueco permanente al ocultarla) + height 100% en PWA instalada.
          "h-dvh sm:h-[min(880px,94dvh)] sm:max-w-[420px]",
          fullBleed ? "bg-black sm:rounded-[44px]" : "sm:rounded-[44px]",
          "sm:phone-frame",
        ].join(" ")}
      >
        <main className="relative flex min-h-0 flex-1 flex-col">
          {/* Onboarding de primera ejecución — tapa las vistas dentro del
              frame y hace fade-out al completarse (transición a biblioteca). */}
          <AnimatePresence>
            {showOnboarding && (
              <motion.div
                key="onboarding-root"
                className="ios-bg absolute inset-0 z-10 flex flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                <OnboardingView />
              </motion.div>
            )}
          </AnimatePresence>

          {!showOnboarding && (
            <AnimatePresence initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, x: direction * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -20 }}
                transition={{ duration: 0.19, ease: [0.32, 0.72, 0, 1] }}
                className="absolute inset-0 flex flex-col"
              >
                {view === "library" && <LibraryView />}
                {view === "camera" && <CameraView />}
                {view === "editor" && <EditorView />}
                {view === "settings" && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        {!showOnboarding && (view === "library" || view === "settings") && <BottomNav />}
      </div>
    </div>
  );
}
