/**
 * Iconos inline (copiados de los code.html del zip v2 — fuente de verdad).
 * Sin dependencias de librería de iconos: cada SVG calca el diseño original.
 */

type IconProps = { className?: string };

/** Flecha «←» (TopBar — SPEC-e14-cyber-neon §3.3: peso más grueso, strokeWidth 2.5). */
export const ArrowLeftIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[2.5] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const CloudCheckIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17 15.09 9.09 16.5 10.5 10 17z" />
  </svg>
);

export const CloudOffIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M17.5 17H6a4 4 0 0 1-1.2-7.8A6 6 0 0 1 16.7 6.6M3 3l18 18" />
  </svg>
);

export const CameraNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
  </svg>
);

/** ACTAS del nav — SPEC-e14-cyber-neon §9: documento OUTLINE strokeWidth 1.8
 *  (trazo claro #C7CEDA, bien visible — no apagado). */
export const DocumentNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.8] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
  </svg>
);

export const GridNavIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </svg>
);

/** RESUMEN del nav — SPEC-e14-cyber-neon §9: icono NUEVO «GridIcon» =
 *  cuadrícula 2×2 de 4 cuadritos redondeados (7×7, rx 2, gap 3px),
 *  viewBox exacto 17×17. */
export const GridIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 17 17" aria-hidden>
    <rect x="0" y="0" width="7" height="7" rx="2" />
    <rect x="10" y="0" width="7" height="7" rx="2" />
    <rect x="0" y="10" width="7" height="7" rx="2" />
    <rect x="10" y="10" width="7" height="7" rx="2" />
  </svg>
);

export const RefreshIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} fill-none stroke-current stroke-2`}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

export const WarnTriangleIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

export const CropIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
    <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
  </svg>
);

export const RotateIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21.5 2v6h-6" />
    <path d="M21.34 15.57a10 10 0 1 1-.57-8.38" />
  </svg>
);

export const FullscreenIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

export const ChevronDownIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ShieldCheckIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const DocScannerIcon = ({ className = "w-9 h-9" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.5] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M7 12h10M7 8h10M8 16h4" />
  </svg>
);

export const SensorsIcon = ({ className = "w-3 h-3" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 12a2 2 0 1 0 0-.001" />
    <path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </svg>
);

export const CheckIcon = ({
  className = "w-3.5 h-3.5",
  strokeWidth = 2,
}: IconProps & { strokeWidth?: number }) => (
  <svg
    className={`${className} stroke-current fill-none`}
    style={{ strokeWidth }}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const ImportIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const EyeIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Linterna del flash (L3 — silueta de linterna, mismo patrón SVG inline). */
export const FlashIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden>
    <path d="M6 2h12a1 1 0 0 1 1 1v3.5a3 3 0 0 1-.88 2.12L15 11.5V21a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-9.5L5.88 8.62A3 3 0 0 1 5 6.5V3a1 1 0 0 1 1-1zm1 2v2.5a1 1 0 0 0 .29.71L10 10h4l2.71-2.79A1 1 0 0 0 17 6.5V4H7zm3 8v7h1.5v-7H10z" />
    <path d="M8.5 5.5h2l.5 2-1.5 1.5L8.5 7.5z" />
  </svg>
);

/** Encuadre de escaneo (L3 — toggle AUTO del visor, 4 esquinas del lab Scan). */
export const ScanFrameIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
  </svg>
);

export const DownloadIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} fill-none stroke-current stroke-2`}
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>
);

/** Sliders (F2 — gatillo FILTROS de la barra de revisión; trazo calca el
 *  `sliders-horizontal` de lucide, mismo patrón SVG inline del archivo). */
export const SlidersIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </svg>
);

/** Sparkles (F4 — DETECCIÓN AUTOMÁTICA del editor de recorte; trazo calca el
 *  `sparkles` de lucide, mismo patrón SVG inline del archivo). */
export const SparklesIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    <path d="M5 16l.7 1.6L7.3 18l-1.6.7L5 20.3l-.7-1.6L2.7 18l1.6-.4L5 16z" />
  </svg>
);

/** ScanText (F-OCR/D39 — botón TEXTO de la barra + título del sheet; trazo
 *  calca el `scan-text` de lucide, mismo patrón SVG inline del archivo). */
export const ScanTextIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8h8" />
    <path d="M7 12h10" />
    <path d="M7 16h6" />
  </svg>
);

/** Copy (F-OCR/D39 — botón «Copiar texto» del sheet; trazo calca el `copy`
 *  de lucide, mismo patrón SVG inline del archivo). */
export const CopyIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

/** LoaderCircle (F-OCR/D39 — spinner «Reconociendo texto…»; trazo calca el
 *  `loader-circle` de lucide; se usa con clase animate-spin). */
export const LoaderIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

/** MapPin (SPEC-cabecera-clasificacion §5 — cabecera del panel de corrección
 *  de ubicación; trazo calca el `map-pin` de lucide, mismo patrón SVG inline). */
export const MapPinIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

/** PlusCircle (D6 SPEC-rediseno-chrome-3-estados — CTA «SEGUIR ESCANEANDO»
 *  de ENVIADA: el icono ⊕ del mock «score alto»; trazo calca el
 *  `circle-plus` de lucide, mismo patrón SVG inline del archivo). */
export const PlusCircleIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </svg>
);

/** Plus (SPEC-e14-cyber-neon §8 — «+» del CTA «SEGUIR ESCANEANDO»:
 *  círculo negro a la izquierda del bloque de texto, trazo grueso 3). */
export const PlusIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[3] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** X (SPEC-e14-cyber-neon §10 — ✕ de la barra de rechazo: círculo crit
 *  sólido con X negra strokeWidth 3, espejo del check de envío). */
export const XIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[3] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** UserKey (D6-bis SPEC-rediseno-chrome-3-estados Rev. 3 — botón «REVISIÓN
 *  HUMANA»: glifo persona + llave de la imagen QR de referencia del dueño;
 *  busto a la izquierda (cabeza circular + hombros) y llave vertical a la
 *  derecha (anillo redondo, tallo y un diente), mismo patrón SVG inline). */
export const UserKeyIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <circle cx="8" cy="7.5" r="3.5" />
    <path d="M2.5 20.5a5.5 5.5 0 0 1 11 0" />
    <circle cx="17.5" cy="7.5" r="3" />
    <path d="M17.5 10.5v10" />
    <path d="M17.5 16.5h3.5" />
  </svg>
);

/** FolderInput (SPEC-e14-cyber-neon-captura §1/§8 — botón IMPORTAR de la fila
 *  de disparo: carpeta con flecha entrando; trazo calca el `folder-input` de
 *  lucide, strokeWidth 1.8 como pide la spec). */
export const FolderImportIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.8] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
    <path d="M2 13h10" />
    <path d="m9 16 3-3-3-3" />
  </svg>
);

/** Bolt (SPEC-e14-cyber-neon-captura §1/§8 — botón FLASH de la fila de
 *  disparo: rayo HUD del mock; trazo calca el `zap` clásico de lucide,
 *  strokeWidth 1.8 como pide la spec). */
export const BoltIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.8] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

/** FocusFrame (SPEC-e14-cyber-neon-captura §1/§4 — botón HUD ámbar superior
 *  derecho: 4 brackets de enfoque + punto central (retícula de cámara pro);
 *  strokeWidth 2, hereda el color ámbar del botón). */
export const FocusFrameIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-2 fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="1.6" />
  </svg>
);

/** FileDoc (SPEC-e14-cyber-neon-captura §1/§8 — icono del OBTURADOR: el mock
 *  sustituye el círculo liso por un documento con líneas (es un escáner de
 *  actas); trazo calca el `file-text` de lucide, strokeWidth 1.8). */
export const FileDocIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current stroke-[1.8] fill-none`}
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
);

/* ══════════════════════════════════════════════════════════════════
   STITCH REDESIGN (SPEC-e14-redesign-stitch §1) — SVG inline del ZIP
   copiados TAL CUAL (download/stitch-e14-redesign/...). Se usan en el
   chrome re-vestido; los paths/valores son verbatim de los code.html.
   ══════════════════════════════════════════════════════════════════ */

/** Grid de la píldora IA del escaneo (mock 1: puntos 4×4 + 4 rects rx 1.5). */
export const StitchGridIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden>
    <path
      d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"
      fill="currentColor"
      opacity="0.2"
    />
    <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </svg>
);

/** Encuadre del botón amarillo de modo (mock 1, strokeWidth 2.2). */
export const StitchFrameIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2.2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2m-10 0H5a2 2 0 01-2-2v-2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Importar del dock (mock 1: documento con flecha descendente). */
export const StitchImportIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg className={`${className} stroke-current fill-none`} strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 11v5m0 0l-2-2m2 2l2-2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Documento del interior del obturador (mock 1, strokeWidth 2). */
export const StitchShutterDocIcon = ({ className = "w-8 h-8" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none drop-shadow`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Rayo del Flash del dock (mock 1). */
export const StitchBoltIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Cámara del ítem ESCANEAR de la nav (mock, strokeWidth 2). */
export const StitchCameraIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Documento del ítem ACTAS de la nav (mock, strokeWidth 1.8). */
export const StitchDocIcon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="1.8"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Cuadrícula 2×2 del ítem RESUMEN de la nav (mock, strokeWidth 1.8). */
export const StitchGrid2Icon = ({ className = "w-5 h-5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="1.8"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Lupa-ojo del CTA REVISIÓN HUMANA (mock rechazada_2, strokeWidth 2). */
export const StitchEyeIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Badge giratorio de los CTAs de repetir (mock, strokeWidth 2.5). */
export const StitchSpinIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} animate-spin stroke-current fill-none`}
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.03 8.03 0 01-15.357-2m15.357 2H15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Recortar de la fila de acciones (mock rechazada_1, strokeWidth 2). */
export const StitchCropIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M6 2v14a2 2 0 002 2h14" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18 22V8a2 2 0 00-2-2H2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Rotar 90° de la fila de acciones (mock rechazada_1, strokeWidth 2). */
export const StitchRotateIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.03 8.03 0 01-15.357-2m15.357 2H15"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Pantalla completa de la fila de acciones (mock, strokeWidth 2). */
export const StitchFullscreenIcon = ({ className = "w-3.5 h-3.5" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none shrink-0`}
    strokeWidth="2"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Nube de transmisión del TopBar (mock — check, fill). */
export const StitchCloudCheckIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <svg className={`${className} fill-current animate-pulse`} viewBox="0 0 24 24" aria-hidden>
    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 13.6l-2.6-2.6L6 12.4l4 4 8-8-1.4-1.4-6.6 6.6z" />
  </svg>
);

/** Retro «←» del TopBar (mock, strokeWidth 2.5). */
export const StitchArrowLeftIcon = ({ className = "w-6 h-6" }: IconProps) => (
  <svg
    className={`${className} stroke-current fill-none`}
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    aria-hidden
  >
    <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
