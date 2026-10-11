"use client";

/**
 * Aviso iOS de «Sin conexión» (v13-post-15).
 *  · Píldora de vidrio oscuro flotando arriba del marco (mismo material que
 *    los toasts de sonner — iOS usa vidrio oscuro para avisos del sistema
 *    sobre cualquier fondo, claro u oscuro).
 *  · NO bloquea la interfaz: pointer-events-none (es informativo, no un
 *    diálogo); los lectores de pantalla lo reciben por role=status +
 *    aria-live=polite al aparecer.
 *  · Histéresis anti-parpadeo (conexiones móviles intermitentes): el aviso
 *    se confirma tras OFFLINE_CONFIRM_MS sin red; al volver la conexión se
 *    esconde AL INSTANTE (la desaparición es la señal de «ya hay red»).
 *  · Entrada/salida con framer-motion → se desactiva sola con
 *    «Reducir movimiento» (MotionConfig reducedMotion="user" en Providers).
 *  · Copys honestos: captura/warp/PDF son 100 % locales (worker propio);
 *    el OCR local descarga su motor del CDN la PRIMERA vez — si no está
 *    cacheado, ese flujo ya avisa con su propio error de red.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";

/** Confirmación antes de mostrar el aviso (ms) — evita flashes con wifi inestable. */
const OFFLINE_CONFIRM_MS = 1200;

export default function OfflineNotice() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // SSR/guard: en el servidor navigator no existe (el componente se monta
    // en el cliente, pero Next prerenderiza el árbol).
    if (typeof navigator === "undefined") return;

    let showTimer: ReturnType<typeof setTimeout> | null = null;

    const confirmOffline = () => {
      if (showTimer) return; // ya esperando confirmación
      showTimer = setTimeout(() => {
        showTimer = null;
        setOffline(true);
      }, OFFLINE_CONFIRM_MS);
    };

    const goOnline = () => {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      setOffline(false); // salida inmediata: sin espera ni animación de más
    };

    const onOffline = () => confirmOffline();
    const onOnline = () => goOnline();

    // Estado inicial: si la app se abre YA sin red, el aviso aparece (con
    // la misma confirmación — un cargador de página en offline puede dar
    // un evento espurio).
    if (!navigator.onLine) confirmOffline();

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          key="offline-notice"
          role="status"
          aria-live="polite"
          /* Texto VISUAL corto («Sin conexión») para no tapar los botones de
           * las esquinas del marco (X/⋮ de cámara, volver del editor) en
           * pantallas de 320 px; la explicación completa viaja en el
           * aria-label para lectores de pantalla. */
          aria-label="Sin conexión. El escaneo y la exportación de PDF siguen disponibles."
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-safe"
        >
          <div className="mt-2 flex max-w-full items-center gap-1.5 rounded-full border-[0.5px] border-white/15 bg-black/80 px-3 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-white/80" aria-hidden="true" />
            <span className="truncate text-xs font-medium tracking-tight text-white/90">
              Sin conexión
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
