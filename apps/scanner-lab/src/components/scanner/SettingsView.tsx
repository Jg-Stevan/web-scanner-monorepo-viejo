"use client";

/**
 * ⚙️ Ajustes — grupos estilo iOS (Apariencia, Captura, Procesamiento,
 * Exportación, Almacenamiento, Acerca de) con switches azules, select de
 * calidad PDF y borrado de todos los documentos con confirmación.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy, FileText, Layers, Monitor, Moon, PlusSquare, ScanText, Star, Sun, Tags, Trash2, Type, HardDrive } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { useIsHydrated } from "@/hooks/use-is-hydrated";

import { useScannerStore } from "@jg-stevan/scanner-core/store";
import { type ScannerSettings } from "@jg-stevan/scanner-core/types";
import { dataUrlBytes, formatBytes } from "@jg-stevan/scanner-core/format";
import { countTagUsage } from "@jg-stevan/scanner-core/tags";
import { countWords } from "@jg-stevan/scanner-core/text-export";
import { getScannerWorker } from "@jg-stevan/scanner-core/image-processor";
import { PROCESSED_MAX_LONG_SIDE } from "@jg-stevan/scanner-core/image-processor";
import { storageAvailable } from "@jg-stevan/scanner-core/page-store";
// FIX v13-post — diagnóstico del dispositivo (solo lectura) para Ajustes.
import { getDeviceProfile, type DeviceProfileRecord } from "@/lib/device-profile";
import { isSocialWebView } from "@/lib/webview";
import { isStandalone } from "@jg-stevan/scanner-core/pwa";
import {
  getPwaInstallState,
  promptInstall,
  subscribePwaState,
  type PwaInstallState,
} from "@jg-stevan/scanner-core/pwa";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Switch iOS: 51×31, thumb 25px, azul #007AFF cuando está activo. */
const SWITCH_IOS =  "h-[31px] w-[51px] data-[state=checked]:bg-[#007aff] data-[state=unchecked]:bg-[#e9e9ea] dark:data-[state=unchecked]:bg-[#39393d] [&_[data-slot=switch-thumb]]:size-[25px]";

/** Atajos de teclado de escritorio (mostrados en Acerca de). */
const SHORTCUTS: { action: string; keys: string[]; hint?: string }[] = [
  { action: "Atrás / cerrar vista", keys: ["Esc"] },
  { action: "Salir de la selección múltiple", keys: ["Esc"] },
  { action: "Buscar en la biblioteca", keys: ["/"] },
  { action: "Página anterior · siguiente", keys: ["←", "→"] },
  { action: "Mover la página actual", keys: ["Alt", "←", "→"], hint: "Reordenar sin arrastre" },
  { action: "Primera · última página", keys: ["Inicio", "Fin"], hint: "Editor y presentación" },
  { action: "Navegar y zoom en presentación", keys: ["←", "→", "+", "−"] },
  { action: "Presentación automática", keys: ["Espacio"], hint: "Avanza sola cada 5 s" },
  { action: "Salir de presentación", keys: ["Esc"] },
  { action: "Buscar en el texto del documento", keys: ["⌘F"], hint: "En el tab OCR" },
  { action: "Coincidencia anterior · siguiente", keys: ["⇧", "↩"] },
];

/** Gestos táctiles (documentados igual que los atajos). */
const GESTURES: { action: string; hint: string }[] = [
  { action: "Comparar con el original", hint: "Mantén pulsada la imagen del documento" },
  { action: "Reordenar páginas", hint: "Mantén pulsada una miniatura y arrastra" },
  { action: "Reordenar biblioteca", hint: "Orden Manual + asa ⠿ en la vista de lista" },
  { action: "Selección múltiple", hint: "Pulsación larga sobre un documento" },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Mini-card de estadística (patrón widget de iOS: número grande + label).
 *  v13-post-10 — `countTo` anima el número de 0 al valor con easeOutCubic
 *  (~600 ms, escalonado por `delay`): la lectura de «cuánto hay» aterriza
 *  mejor que un número que aparece de golpe. Respeta «Reducir movimiento»
 *  (salta al valor final) y los valores NO numéricos (p. ej. «26.0 KB»)
 *  se muestran como siempre. */
function StatCard({
  value,
  label,
  icon: Icon,
  color,
  delay = 0,
  countTo,
  decimals = 0,
  compactK = false,
}: {
  value: string;
  label: string;
  icon: typeof FileText;
  color: string;
  delay?: number;
  /** Valor numérico a animar (0 → countTo); si se omite, muestra `value` tal cual. */
  countTo?: number;
  /** Decimales al animar (p. ej. páginas/doc = 1). */
  decimals?: number;
  /** Formato compacto ≥1000 (1.2k), como el valor estático de palabras OCR. */
  compactK?: boolean;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number>(countTo ?? 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (countTo === undefined || reduced) {
      setDisplay(countTo ?? 0);
      return;
    }
    const DURATION = 600;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(countTo * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    // El delay de la card también escala la animación (misma coreografía).
    const timer = window.setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick);
    }, delay * 1000);
    return () => {
      window.clearTimeout(timer);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [countTo, reduced, delay]);

  const format = (n: number) =>
    compactK && n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
      : n.toFixed(decimals);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      /* v13-post-7 — micro-elevación al pasar el puntero (escritorio); con
       *  «Reducir movimiento» MotionConfig la desactiva automáticamente. */
      whileHover={{ y: -2, boxShadow: "0 6px 16px rgba(0,0,0,0.10)", transition: { duration: 0.18 } }}
      transition={{ duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-start gap-1 rounded-2xl bg-white dark:bg-[#1c1c1e] px-3 pb-2.5 pt-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      <Icon className="size-[15px]" strokeWidth={2.2} style={{ color }} aria-hidden="true" />
      <span
        className="text-[20px] font-semibold leading-none tracking-[-0.3px] text-[#1c1c1e] dark:text-white tabular-nums"
        aria-label={countTo !== undefined ? value : undefined}
      >
        {countTo !== undefined ? format(display) : value}
      </span>
      <span className="text-[11px] font-medium leading-tight text-[#8e8e93]">{label}</span>
    </motion.div>
  );
}

export default function SettingsView() {
  const settings = useScannerStore((s) => s.settings);
  const updateSettings = useScannerStore((s) => s.updateSettings);
  const documents = useScannerStore((s) => s.documents);
  const wipeLibrary = useScannerStore((s) => s.wipeLibrary);

  const [confirmWipe, setConfirmWipe] = useState(false);

  /* F-TRASH: las estadísticas cuentan solo la biblioteca VIVA (la papelera
   *  se muestra aparte — es contenido distinto, como iOS Files). */
  const liveDocs = useMemo(() => documents.filter((d) => d.deletedAt === undefined), [documents]);
  const trashCount = useMemo(() => documents.length - liveDocs.length, [documents, liveDocs]);

  const totalPages = useMemo(
    () => liveDocs.reduce((n, d) => n + d.pages.length, 0),
    [liveDocs]
  );

  /** Uso estimado: suma de todos los data URLs (originales + procesadas + miniaturas). */
  const storageBytes = useMemo(() => {
    let total = 0;
    for (const d of liveDocs) {
      for (const p of d.pages) {
        total += dataUrlBytes(p.original) + dataUrlBytes(p.processed) + dataUrlBytes(p.thumbnail);
      }
    }
    return total;
  }, [liveDocs]);

  const wipeAll = () => {
    if (documents.length === 0) {
      toast("No hay documentos que borrar");
      setConfirmWipe(false);
      return;
    }
    wipeLibrary();
    toast.success("Se borraron todos los documentos");
    setConfirmWipe(false);
  };

  /* ── Estadísticas de la biblioteca (panel resumen) ── */
  const favoriteCount = useMemo(
    () => liveDocs.filter((d) => d.favorite).length,
    [liveDocs]
  );
  const tagCount = useMemo(() => countTagUsage(liveDocs).length, [liveDocs]);
  const ocrPages = useMemo(
    () => liveDocs.reduce((n, d) => n + d.pages.filter((p) => p.ocrDone).length, 0),
    [liveDocs]
  );
  /** F-STATS: palabras totales extraídas por OCR en la biblioteca viva. */
  const ocrWords = useMemo(
    () =>
      liveDocs.reduce(
        (n, d) => n + d.pages.reduce((m, p) => m + countWords(p.ocrText ?? ""), 0),
        0
      ),
    [liveDocs]
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#f2f2f7] dark:bg-black">
      {/* Header */}
      <header className="shrink-0 px-5 pb-2 pt-safe">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.4px] text-black dark:text-white">
          Ajustes
        </h1>
        <p className="mt-1 text-[13px] text-[#8e8e93]">Personaliza tu escáner</p>
      </header>

      {/* Grupos estilo iOS con scroll central */}
      <div className="ios-scroll flex-1 overflow-y-auto overscroll-contain pb-8">
        {/* Panel de estadísticas de la biblioteca */}
        <section aria-label="Estadísticas de la biblioteca" className="px-5 pb-1 pt-2">
          <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6d6d72] dark:text-[#98989e]">
            Tu biblioteca
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              value={String(liveDocs.length)}
              countTo={liveDocs.length}
              label={plural(liveDocs.length, "documento", "documentos")}
              icon={FileText}
              color="#007aff"
              delay={0.03}
            />
            <StatCard
              value={String(totalPages)}
              countTo={totalPages}
              label={plural(totalPages, "página", "páginas")}
              icon={Layers}
              color="#5856d6"
              delay={0.06}
            />
            <StatCard
              value={String(ocrPages)}
              countTo={ocrPages}
              label="con texto OCR"
              icon={ScanText}
              color="#34c759"
              delay={0.09}
            />
            <StatCard
              value={ocrWords >= 1000 ? `${(ocrWords / 1000).toFixed(1).replace(".0", "")}k` : String(ocrWords)}
              countTo={ocrWords}
              compactK
              label={ocrWords === 1 ? "palabra OCR" : "palabras OCR"}
              icon={Type}
              color="#30d158"
              delay={0.12}
            />
            <StatCard
              value={String(favoriteCount)}
              countTo={favoriteCount}
              label={plural(favoriteCount, "favorito", "favoritos")}
              icon={Star}
              color="#ff9500"
              delay={0.15}
            />
            <StatCard
              value={String(tagCount)}
              countTo={tagCount}
              label={plural(tagCount, "etiqueta", "etiquetas")}
              icon={Tags}
              color="#ff2d55"
              delay={0.18}
            />
            <StatCard
              value={formatBytes(storageBytes)}
              label="espacio usado"
              icon={HardDrive}
              color="#8e8e93"
              delay={0.21}
            />
            <StatCard
              value={String(trashCount)}
              countTo={trashCount}
              label="en Eliminados"
              icon={Trash2}
              color="#ff453a"
              delay={0.24}
            />
            <StatCard
              value={String(liveDocs.length > 0 ? Math.round((totalPages / liveDocs.length) * 10) / 10 : 0)}
              countTo={liveDocs.length > 0 ? Math.round((totalPages / liveDocs.length) * 10) / 10 : 0}
              decimals={1}
              label="páginas/doc"
              icon={Layers}
              color="#64d2ff"
              delay={0.27}
            />
          </div>
        </section>

        {/* Apariencia: tema claro/oscuro/sistema (persiste en localStorage) */}
        <AppearanceSection />

        {/* F-PWA: instalación en el móvil (Android: prompt nativo · iOS: guía) */}
        <InstallSection />

        <SettingsGroup label="Procesamiento" delay={0.1}>
          {/* FIX v3: fila informativa estática (sin medición) — el benchmark
              F-DEVBENCH se eliminó: la app procesa SIEMPRE al máximo del
              lente con tope técnico único. */}
          <SettingsRow
            title="Resolución de procesado"
            subtitle="Máxima calidad · tope técnico del canvas en iOS"
          >
            <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
              {PROCESSED_MAX_LONG_SIDE} px
            </span>
          </SettingsRow>
          <SettingsRow
            title="Mejora automática"
            subtitle="Empieza cada captura con el filtro «B/N adaptativo» (apagado: Original puro)"
          >
            <Switch
              checked={settings.enhance}
              onCheckedChange={(v) => updateSettings({ enhance: v })}
              aria-label="Mejora automática"
              className={SWITCH_IOS}
            />
          </SettingsRow>
          <SettingsRow
            title="OCR automático"
            subtitle="Reconoce el texto al capturar. Apagado por defecto para ahorrar memoria: usa el botón «Texto» del editor cuando lo necesites"
          >
            <Switch
              checked={settings.ocrEnabled}
              onCheckedChange={(v) => updateSettings({ ocrEnabled: v })}
              aria-label="OCR automático"
              className={SWITCH_IOS}
            />
          </SettingsRow>
          <SettingsRow
            title="Flash de captura"
            subtitle="Auto lo enciende solo en escenas oscuras (y lo apaga al disparar)"
          >
            <Select
              value={settings.flashMode}
              onValueChange={(v) =>
                updateSettings({ flashMode: v as ScannerSettings["flashMode"] })
              }
            >
              <SelectTrigger
                aria-label="Flash de captura"
                className="h-9 rounded-lg border-[#e5e5ea] bg-[#f2f2f7] dark:border-[#3a3a3c] dark:bg-[#2c2c2e] px-3.5 text-[14px] font-medium text-[#3c3c43] dark:text-white shadow-none focus-visible:ring-[3px] focus-visible:ring-[#007aff]/25 focus-visible:border-[#007aff]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#e5e5ea] dark:border-[#38383a]">
                <SelectItem value="off" className="text-[14px]">
                  Apagado
                </SelectItem>
                <SelectItem value="auto" className="text-[14px]">
                  Auto
                </SelectItem>
                <SelectItem value="on" className="text-[14px]">
                  Encendido
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            title="Motor de precisión"
            subtitle="OpenCV · contornos + RANSAC + homografía"
          >
            <EngineBadge />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Exportación" delay={0.15}>
          <SettingsRow title="Calidad PDF">
            <Select
              value={settings.exportQuality}
              onValueChange={(v) =>
                updateSettings({ exportQuality: v as ScannerSettings["exportQuality"] })
              }
            >
              <SelectTrigger
                aria-label="Calidad PDF"
                className="h-9 rounded-lg border-[#e5e5ea] bg-[#f2f2f7] dark:border-[#3a3a3c] dark:bg-[#2c2c2e] px-3.5 text-[14px] font-medium text-[#3c3c43] dark:text-white shadow-none focus-visible:ring-[3px] focus-visible:ring-[#007aff]/25 focus-visible:border-[#007aff]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#e5e5ea] dark:border-[#38383a]">
                <SelectItem value="standard" className="text-[14px]">
                  Estándar
                </SelectItem>
                <SelectItem value="alta" className="text-[14px]">
                  Alta
                </SelectItem>
                <SelectItem value="máxima" className="text-[14px]">
                  Máxima
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup label="Almacenamiento" delay={0.15}>
          <SettingsRow
            title="Uso estimado"
            subtitle={`${plural(liveDocs.length, "documento", "documentos")} · ${plural(
              totalPages,
              "página",
              "páginas"
            )}`}
          >
            <span className="shrink-0 text-[15px] text-[#8e8e93]">{formatBytes(storageBytes)}</span>
          </SettingsRow>
          <SettingsRow
            title="Persistencia local"
            subtitle="IndexedDB · los documentos sobreviven al recargar"
          >
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
                storageAvailable()
                  ? "bg-[#34c759]/12 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
                  : "bg-[#8e8e93]/15 text-[#8e8e93]"
              )}
              role="status"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  storageAvailable()
                    ? "bg-[#34c759] shadow-[0_0_5px_rgba(52,199,89,0.8)]"
                    : "bg-[#8e8e93]"
                )}
                aria-hidden="true"
              />
              {storageAvailable() ? "Activa" : "No disp."}
            </span>
          </SettingsRow>
          <SettingsRow
            title="Borrar todos los documentos"
            destructive
            disabled={documents.length === 0}
            onClick={documents.length > 0 ? () => setConfirmWipe(true) : undefined}
          >
            <Trash2 className="h-[18px] w-[18px] shrink-0 text-[#ff3b30]" strokeWidth={2} aria-hidden="true" />
          </SettingsRow>
        </SettingsGroup>

        {/* FIX v13-post — Diagnóstico del dispositivo (solo lectura): hace
            visible el perfil 13.1 en el QA físico sin consola remota.
            ⛔ No altera captura ni análisis (invariante de la spec v13). */}
        <DeviceSection />

        <SettingsGroup label="Acerca de" delay={0.2}>
          <SettingsRow title="Versión">
            <span className="shrink-0 text-[15px] text-[#8e8e93]">2.0.0</span>
          </SettingsRow>
          <div className="border-t border-[#f2f2f7] dark:border-[#38383a] px-4 py-3">
            <p className="text-[15px] text-[#1c1c1e] dark:text-white">Atajos de teclado</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.action} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] leading-snug text-[#8e8e93]">
                    {s.action}
                    {s.hint && (
                      <span className="ml-1.5 text-[11px] text-[#c7c7cc]">{s.hint}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-[#d1d1d6] border-b-2 bg-white dark:border-[#48484a] dark:bg-[#2c2c2e] dark:shadow-none px-1.5 font-sans text-[11px] font-semibold text-[#3c3c43] dark:text-white shadow-[0_1px_0_rgba(0,0,0,0.04)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-[#f2f2f7] dark:border-[#38383a] px-4 py-3">
            <p className="text-[15px] text-[#1c1c1e] dark:text-white">Gestos</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {GESTURES.map((g) => (
                <div key={g.action} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] leading-snug text-[#8e8e93]">{g.action}</span>
                  <span className="max-w-[190px] text-right text-[11px] leading-snug text-[#c7c7cc]">
                    {g.hint}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-h-[44px] items-center border-t border-[#f2f2f7] dark:border-[#38383a] px-4 py-3">
            <p className="text-[15px] text-[#8e8e93]">Hecho con precisión</p>
          </div>
        </SettingsGroup>

      </div>

      {/* AlertDialog: borrar todos los documentos */}
      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar todos los documentos?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán {plural(documents.length, "documento", "documentos")} con todas sus
              páginas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel className="mt-0 flex-1 rounded-full bg-[#f2f2f7] text-[15px] font-semibold text-[#3c3c43] hover:bg-[#e5e5ea] dark:bg-[#2c2c2e] dark:text-white dark:hover:bg-[#3a3a3c]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={wipeAll}
              className="flex-1 rounded-full border-0 bg-[#ff3b30] text-[15px] font-semibold text-white hover:bg-[#ff453a]"
            >
              Borrar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas de los grupos estilo iOS                                     */
/* ------------------------------------------------------------------ */

/** Badge vivo del motor de precisión (worker + OpenCV) en Ajustes. */
function EngineBadge() {
  const [state, setState] = useState<"checking" | "on" | "off">("checking");
  useEffect(() => {
    let stop = false;
    const apply = (s: "on" | "off") => {
      if (!stop) setState(s);
    };
    const c = getScannerWorker();
    if (c && !c.isDead) {
      void c.waitReady().then((ok) => {
        if (ok) apply("on");
      });
    }
    const iv = window.setInterval(() => {
      const cc = getScannerWorker();
      if (cc?.isReady) {
        apply("on");
        window.clearInterval(iv);
      } else if (cc?.isDead) {
        apply("off");
        window.clearInterval(iv);
      }
    }, 800);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, []);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
        state === "on"
          ? "bg-[#34c759]/12 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
          : state === "checking"
            ? "bg-[#8e8e93]/15 text-[#8e8e93]"
            : "bg-[#ff3b30]/10 text-[#ff3b30] dark:text-[#ff453a]"
      )}
      role="status"
      aria-label={`Motor de precisión ${state === "on" ? "activo" : state === "checking" ? "cargando" : "no disponible"}`}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          state === "on"
            ? "bg-[#34c759] shadow-[0_0_5px_rgba(52,199,89,0.8)]"
            : state === "checking"
              ? "animate-pulse bg-[#8e8e93]"
              : "bg-[#ff3b30]"
        )}
        aria-hidden="true"
      />
      {state === "on" ? "Activo" : state === "checking" ? "Cargando…" : "No disp."}
    </span>
  );
}

/** Sección de apariencia — tema Claro / Oscuro / Sistema (next-themes).
 *  · Filas estilo iOS con icono + check azul en la preferencia activa.
 *  · next-themes persiste la elección en localStorage (clave "theme")
 *    y "Sistema" sigue el esquema de color del dispositivo.
 *  · El check solo se pinta tras la hidratación (resolvedTheme no existe
 *    en SSR — evita el mismatch de hidratación). */
function AppearanceSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useIsHydrated();

  const current = theme ?? "system";

  const options: {
    id: "light" | "dark" | "system";
    label: string;
    icon: typeof Sun;
  }[] = [
    { id: "light", label: "Claro", icon: Sun },
    { id: "dark", label: "Oscuro", icon: Moon },
    { id: "system", label: "Sistema", icon: Monitor },
  ];

  return (
    <SettingsGroup label="Apariencia" delay={0.05}>
      {options.map((o) => {
        const active = mounted && current === o.id;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            aria-label={`Tema ${o.label.toLowerCase()}`}
            onClick={() => setTheme(o.id)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-[#f2f2f7] dark:border-[#38383a] px-4 py-3 text-left transition-colors first:border-t-0 active:bg-[#f7f7f9] dark:active:bg-[#2c2c2e]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon
                className="size-5 shrink-0 text-[#3c3c43] dark:text-white"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-[15px] leading-snug text-black dark:text-white">
                  {o.label}
                </span>
                {o.id === "system" && (
                  <span className="block text-[12px] leading-snug text-[#8e8e93]">
                    {mounted && resolvedTheme === "dark" ? "Ahora: oscuro" : "Ahora: claro"}
                  </span>
                )}
              </span>
            </span>
            {active ? (
              <Check
                className="size-5 shrink-0 text-[#007aff] dark:text-[#0a84ff]"
                strokeWidth={2.6}
                aria-hidden="true"
              />
            ) : (
              <span className="size-5 shrink-0" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </SettingsGroup>
  );
}

function SettingsGroup({
  label,
  delay = 0,
  children,
}: {
  label: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      aria-label={label}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
    >
      <h2 className="px-5 pb-1.5 pt-4 text-[13px] font-medium uppercase tracking-[0.04em] text-[#8e8e93]">
        {label}
      </h2>
      <div className="mx-4 overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e] shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </motion.section>
  );
}

function SettingsRow({
  title,
  subtitle,
  destructive,
  disabled,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const className = cn(
    "flex min-h-[44px] w-full items-center justify-between gap-3 border-t border-[#f2f2f7] dark:border-[#38383a] px-4 py-3 text-left first:border-t-0 transition-colors",
    onClick && "cursor-pointer active:bg-[#f7f7f9] dark:active:bg-[#2c2c2e]",
    disabled && "cursor-default opacity-40"
  );

  const content = (
    <>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[15px] leading-snug",
            destructive ? "font-medium text-[#ff3b30]" : "text-black dark:text-white"
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] leading-snug text-[#8e8e93]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

/** FIX v13-post — Sección de diagnóstico del dispositivo (SOLO LECTURA).
 *  Muestra el perfil 13.1 (tier, plataforma, hardware, benchmark) en
 *  Ajustes para que el QA físico no requiera consola remota. Se relee a
 *  los 4,5 s para capturar el micro-benchmark idle (timeout 3 s). El tier
 *  es diagnóstico puro: NUNCA cambia captura ni análisis (4032 px siempre).
 *
 *  v13-post-5 — ampliado con el entorno de compatibilidad v13: WebView
 *  social (13.4), cuota de almacenamiento (StorageManager.estimate) y
 *  «Copiar diagnóstico» (protocolo §5 del informe: el QA físico reporta el
 *  perfil sin consola remota pegando un único texto). Todo solo-lectura. */
function DeviceSection() {
  const [profile, setProfile] = useState<DeviceProfileRecord | null>(null);
  /** Cuota del navegador: null = cargando · "no" = API no expuesta. */
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null | "no">(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setProfile(getDeviceProfile());
    // El micro-benchmark corre en idle (requestIdleCallback timeout 3 s);
    // una segunda lectura a los 4,5 s lo captura si aún no había terminado.
    const t = window.setTimeout(() => setProfile(getDeviceProfile()), 4500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } };
    if (typeof nav.storage?.estimate !== "function") {
      setStorage("no");
      return;
    }
    nav.storage
      .estimate()
      .then((e) => {
        if (alive && typeof e.usage === "number" && typeof e.quota === "number" && e.quota > 0) {
          setStorage({ usage: e.usage, quota: e.quota });
        } else if (alive) setStorage("no");
      })
      .catch(() => alive && setStorage("no"));
    return () => {
      alive = false;
    };
  }, []);

  const tier = profile?.tier;
  /** v13-post-7 — medidor segmentado del tier (barras estilo señal iOS):
   *  bajo = 1 barra, medio = 2, alto = 3; el color lo manda el tier. */
  const tierIdx = tier === "alto" ? 2 : tier === "medio" ? 1 : tier === "bajo" ? 0 : -1;
  const tierColor =
    tier === "alto" ? "#34c759" : tier === "medio" ? "#ff9500" : tier === "bajo" ? "#ff3b30" : null;
  const platformLabel =
    profile?.platform === "ios"
      ? `iOS${profile.osMajor ? " " + profile.osMajor : ""}`
      : profile?.platform === "android"
        ? `Android${profile.osMajor ? " " + profile.osMajor : ""}`
        : "Otro";
  const socialWebView = profile ? isSocialWebView(profile.ua) : false;

  /** % de la cuota usada (para el mini-medidor y el reporte). */
  const storagePct =
    storage && storage !== "no" ? Math.min(100, (storage.usage / storage.quota) * 100) : null;

  /** Reporte compacto para pegar en el issue de QA físico (protocolo §5). */
  const buildReport = () => {
    const L: string[] = [];
    L.push("ScannerLab · Diagnóstico v13");
    if (tier) {
      L.push(`· Rendimiento: ${tier === "alto" ? "Alto" : tier === "medio" ? "Medio" : "Bajo"}${profile?.benchMs != null ? ` · bench ${profile.benchMs} ms` : ""}`);
      L.push(`· Plataforma: ${platformLabel}`);
      L.push(
        `· CPU: ${profile?.cores != null ? `${profile.cores} núcleos` : "no expuesta"} · RAM: ${profile?.memoryGB != null ? `${profile.memoryGB} GB` : "no expuesta"}`
      );
      L.push(`· Pantalla: ${profile?.dpr}× · ${profile?.secure ? "HTTPS" : "sin HTTPS"}`);
      L.push(`· Entorno: ${socialWebView ? "WebView social (13.4)" : "navegador real"}`);
      if (storage && storage !== "no") {
        L.push(
          `· Almacenamiento: ${formatBytes(storage.usage)} de ${formatBytes(storage.quota)} (${storagePct != null ? storagePct.toFixed(0) : "?"}%)`
        );
      }
      L.push(`· Modo: ${isStandalone() ? "app instalada" : "navegador"}`);
    }
    return L.join("\n");
  };

  const onCopy = async () => {
    const text = buildReport();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Contexto no seguro: fallback clásico con textarea efímera.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Diagnóstico copiado", { description: "Pégalo en el issue de QA (protocolo §5)" });
    } catch {
      toast.error("No se pudo copiar", { description: "Consola remota: window.__deviceProfile" });
    }
  };

  return (
    <SettingsGroup label="Dispositivo" delay={0.2}>
      <SettingsRow
        title="Rendimiento detectado"
        subtitle={`Diagnóstico v13 · no altera la captura (siempre ${PROCESSED_MAX_LONG_SIDE} px)`}
      >
        {tier ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-2.5 py-1 text-[12px] font-semibold",
              tier === "alto"
                ? "bg-[#34c759]/12 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
                : tier === "medio"
                  ? "bg-[#ff9500]/12 text-[#b25000] dark:bg-[#ff9f0a]/15 dark:text-[#ff9f0a]"
                  : "bg-[#ff3b30]/12 text-[#d70015] dark:bg-[#ff453a]/15 dark:text-[#ff453a]"
            )}
            role="status"
          >
            <span className="flex items-end gap-[2px]" aria-hidden="true">
              {(["h-[7px]", "h-[11px]", "h-[15px]"] as const).map((h, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-[5px] rounded-[2px] transition-colors duration-500",
                    h,
                    i <= tierIdx && tierColor ? "" : "bg-black/15 dark:bg-white/20"
                  )}
                  style={i <= tierIdx && tierColor ? { backgroundColor: tierColor } : undefined}
                />
              ))}
            </span>
            {tier === "alto" ? "Alto" : tier === "medio" ? "Medio" : "Bajo"}
          </span>
        ) : (
          <span className="shrink-0 text-[15px] text-[#8e8e93]">…</span>
        )}
      </SettingsRow>
      <SettingsRow title="Plataforma">
        <span className="shrink-0 text-[15px] font-medium text-[#3c3c43] dark:text-white/85">
          {profile ? platformLabel : "…"}
        </span>
      </SettingsRow>
      <SettingsRow title="Procesador" subtitle="Núcleos lógicos expuestos por el navegador">
        <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
          {profile ? (profile.cores !== null ? `${profile.cores} núcleos` : "No expuesto") : "…"}
        </span>
      </SettingsRow>
      <SettingsRow title="Memoria" subtitle="iOS no la expone (el benchmark la deduce)">
        <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
          {profile ? (profile.memoryGB !== null ? `${profile.memoryGB} GB` : "No expuesta") : "…"}
        </span>
      </SettingsRow>
      <SettingsRow title="Decodificación (prueba)" subtitle="Decode+draw de un canvas 256 px, medido en reposo">
        <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
          {profile ? (profile.benchMs !== null ? `${profile.benchMs} ms` : "Midiendo…") : "…"}
        </span>
      </SettingsRow>
      <SettingsRow title="Pantalla" subtitle="Densidad de píxeles del dispositivo">
        <span className="shrink-0 text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
          {profile ? `${profile.dpr}×` : "…"}
        </span>
      </SettingsRow>
      <SettingsRow title="Conexión" subtitle="La cámara web exige contexto seguro">
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
            profile?.secure
              ? "bg-[#34c759]/12 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
              : "bg-[#ff3b30]/12 text-[#d70015] dark:bg-[#ff453a]/15 dark:text-[#ff453a]"
          )}
          role="status"
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", profile?.secure ? "bg-[#34c759]" : "bg-[#ff3b30]")}
            aria-hidden="true"
          />
          {profile ? (profile.secure ? "HTTPS" : "Sin HTTPS") : "…"}
        </span>
      </SettingsRow>
      <SettingsRow
        title="Entorno"
        subtitle={socialWebView ? "WebView de red social: la cámara falla dentro de estas apps" : "Navegador real (la cámara puede funcionar)"}
      >
        {profile ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
              socialWebView
                ? "bg-[#0a84ff]/12 text-[#0040dd] dark:bg-[#0a84ff]/15 dark:text-[#0a84ff]"
                : "bg-[#34c759]/12 text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
            )}
            role="status"
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", socialWebView ? "bg-[#0a84ff]" : "bg-[#34c759]")}
              aria-hidden="true"
            />
            {socialWebView ? "WebView social" : "Navegador"}
          </span>
        ) : (
          <span className="shrink-0 text-[15px] text-[#8e8e93]">…</span>
        )}
      </SettingsRow>
      <SettingsRow title="Almacenamiento" subtitle="Cuota estimada por el navegador para este origen">
        {storage === null ? (
          <span className="shrink-0 text-[15px] text-[#8e8e93]">…</span>
        ) : storage === "no" ? (
          <span className="shrink-0 text-[15px] text-[#8e8e93]">No expuesta</span>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            <span
              className="h-1 w-12 overflow-hidden rounded-full bg-[#e9e9ea] dark:bg-[#39393d]"
              aria-hidden="true"
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-[width] duration-500",
                  (storagePct ?? 0) >= 85
                    ? "bg-[#ff3b30]"
                    : (storagePct ?? 0) >= 60
                      ? "bg-[#ff9500]"
                      : "bg-[#34c759]"
                )}
                style={{ width: `${Math.max(storagePct ?? 0, 2)}%` }}
              />
            </span>
            <span className="text-[15px] font-medium tabular-nums text-[#3c3c43] dark:text-white/85">
              {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
            </span>
          </span>
        )}
      </SettingsRow>
      <SettingsRow
        title={copied ? "Diagnóstico copiado" : "Copiar diagnóstico"}
        subtitle="Texto listo para pegar en el issue de QA físico (protocolo §5)"
        onClick={() => void onCopy()}
      >
        {copied ? (
          <Check className="size-5 shrink-0 text-[#34c759]" strokeWidth={2.4} aria-hidden="true" />
        ) : (
          <Copy className="size-5 shrink-0 text-[#007aff]" strokeWidth={2.2} aria-hidden="true" />
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}

/** F-PWA — Sección de instalación en el móvil. Android/Chrome: botón que
 *  dispara el prompt nativo; iOS: instrucciones de "Añadir a pantalla de
 *  inicio"; ya instalada → estado "Instalada". */
function InstallSection() {
  const [state, setState] = useState<PwaInstallState>(() => getPwaInstallState());

  useEffect(() => subscribePwaState(setState), []);

  const onInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast.success("¡App instalada!");
    else if (outcome === "dismissed") toast("Puedes instalarla más tarde desde este mismo panel");
    else if (state.isIos) {
      toast("En iPhone: Compartir → «Añadir a pantalla de inicio»", { duration: 8000, icon: "📲" });
    } else {
      toast("Tu navegador no ofrece instalación — usa el menú del navegador", { duration: 7000 });
    }
  };

  return (
    <SettingsGroup label="Instalación" delay={0.12}>
      {state.installed ? (
        <SettingsRow title="App instalada" subtitle="Corre a pantalla completa y sin conexión">
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#34c759]/12 px-2.5 py-1 text-[12px] font-semibold text-[#248a3d] dark:bg-[#30d158]/15 dark:text-[#30d158]"
            role="status"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />
            Instalada
          </span>
        </SettingsRow>
      ) : state.isIos ? (
        <SettingsRow
          title="Añadir a pantalla de inicio"
          subtitle="En iPhone: botón Compartir → «Añadir a pantalla de inicio»"
        >
          <button
            type="button"
            aria-label="Ver cómo instalar la app"
            onClick={() =>
              toast("Comparte esta página y elige «Añadir a pantalla de inicio»", {
                duration: 9000,
                icon: "📲",
              })
            }
            className="shrink-0 rounded-full bg-[#007aff] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-transform active:scale-95"
          >
            Cómo
          </button>
        </SettingsRow>
      ) : (
        <SettingsRow
          title="Instalar app en este dispositivo"
          subtitle="Funciona sin conexión y abre como app nativa"
        >
          <button
            type="button"
            aria-label="Instalar la app"
            onClick={() => void onInstall()}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full bg-[#007aff] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-transform active:scale-95",
              !state.canPrompt && "opacity-80"
            )}
          >
            <PlusSquare className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            Instalar
          </button>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

/* F-DEVBENCH (DeviceSection) — ELIMINADO en el fix v3 (fix-editor-quality):
 * la app procesa y guarda SIEMPRE al máximo del lente (tope técnico único
 * 4032 px). Su hueco lo cubre la fila informativa estática
 * "Resolución de procesado" del grupo Procesamiento. */
