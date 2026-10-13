/**
 * RealCoreBridge — el motor REAL de @jg-stevan/scanner-core (SPEC-fase-logica §5).
 * FASE LÓGICA L2: fuente ARCHIVO completa —
 *   fileToCaptureDataUrl → detectDocumentEdges → processImage →
 *   evaluateQuality → requestOcr → mapeo §4 → Acta.
 * FASE LÓGICA L3 (§5 CAMARA): la fuente CÁMARA reusa EL MISMO pipeline con
 *   dos entradas —
 *   · `archivo` (foto ya capturada por ZSL / captureSmart / cámara nativa
 *     iOS — la ruta del spec §7: "la foto entra al mismo pipeline (como
 *     ARCHIVO, L2)");
 *   · `frameActual` (video con stream vivo, último recurso) → grab síncrono
 *     a canvas a RESOLUCIÓN DEL STREAM → dataUrl → pipeline. El grab debe
 *     ocurrir ANTES de que React desmonte el visor (el stream se detiene al
 *     cambiar a ANALIZANDO), por eso se hace en el arranque síncrono de
 *     escanearActa.
 * Mapeo de score §4.1 (techos por level), gate de legibilidad §4.2 (el OCR
 * manda sobre el score: ILEGIBLE calca la rechazada v2) y timeout global de
 * 15 s que RESUELVE un acta RECHAZADA (nunca congela la UI ni revienta el
 * flujo de toasts del store). Etiquetas de etapa idénticas por fuente.
 * FASE LÓGICA L5 (§7.5): `recortar` — re-ejecuta §5 sobre `fotoOriginal` con
 * el QUAD MANUAL (F5-MANUAL del core: `manual: true` respeta el quad al
 * píxel, sin refine) → fotoProcesada nueva → evaluateQuality + gate OCR →
 * acta ACTUALIZADA. El rescate D20 NO consume intento (fuente/intento/
 * maxIntentos/paginación se preservan por spread del acta de entrada).
 *
 * Lo que sigue simulado (votos/firmas/ubicación) se rellena del seed exacto
 * (§0: no se presenta como extraído).
 *
 * UX-REAL F1 (SPEC-ux-real-bn-editor §F1, D35): SIMULACIÓN también pasa por
 * este pipeline — la fuente carga el acta E-14 REAL incluida (§1) y la trata
 * EXACTAMENTE como un `archivo` de IMPORTAR (mismo File → fileToCaptureDataUrl
 * → F-IMPORT: EXIF/12MP). El mock de la fase gráfica se retiró.
 */
import {
  detectDocumentEdges,
  evaluateQuality,
  fileToCaptureDataUrl,
  processImage,
} from "@jg-stevan/scanner-core/image-processor";
import { ocrTextIsValid, requestOcr } from "@jg-stevan/scanner-core/ocr";
import { defaultQuad } from "@jg-stevan/scanner-core/types";
import type {
  PageFilter,
  PageQuality,
  Quad,
} from "@jg-stevan/scanner-core/types";
import { ACTA_MOCK } from "./seed";
import { statusDeScore } from "./types";
import { cargarDivipol } from "./divipol";
import {
  clasificarCabecera,
  PATRON_CABECERA,
  tituloYUbicacionDe,
  type ClasificacionE14,
} from "./clasificador";
import { procesadaVaciaDataUrl } from "./image-utils";
// GUARD-BORDE Rev. 2 (SPEC-e14-guard-borde §2-§3, D1/D3): la verificación de
// completitud vive en helper ÚNICO (completitud.ts) — «la geometría sospecha,
// la tinta condena» — usado por AMBOS pipelines (escaneo y recorte, AC11).
import { verificarCompletitud, type ResultadoCompletitud } from "./completitud";
// §1 (SPEC-ux-real-bn-editor): acta E-14 real del dueño (Galaxy A56 5G) —
// import estático: Next resuelve el basePath /web-scanner del deploy estático.
import actaSimUrl from "@/assets/acta-e14-real.jpg";
// §G-1 (SPEC-camara-funcional): las 3 actas del dueño para la SIMULACIÓN de
// scores — [0] óptima (acta-e14-real, 2287×1715, pipeline COMPLETO con
// detect+warp+bw) · [1] intermedia (la b/n del dueño 980×2112, §D6 Rev. 3:
// acta El Cairo completa en el encuadre, cortada abajo por el borde de la
// FOTO, as-is) · [2] baja (la borrosa del dueño 1902×1426, §D7 Rev. 3:
// as-is, sin filtro ni recorte automático). Los flags viajan en la tabla
// ACTAS_SIM de abajo (§D8).
import actaSimIntermediaUrl from "@/assets/acta-sim-intermedia.jpg";
import actaSimBajaUrl from "@/assets/acta-sim-baja.jpg";
import type { Acta, ActaFirma, ActaStatus, ProgresoAnalisis } from "./types";
import type { E14Bridge, OpcionesEscaneo } from "./bridge";

/** Timeout de seguridad global §5 (worker colgado en gama baja). */
const TIMEOUT_MS = 15_000;
/** Techos/labels del mapeo §4 y el gate §4.2. */
const DETALLE_ILEGIBLE = "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS";
const DETALLE_TIMEOUT = "TIEMPO DE PROCESADO EXCEDIDO";
const DETALLE_GENERICO = "SCORE INSUFICIENTE PARA TRANSMISIÓN";
// §F-5 (SPEC-camara-funcional): detalle del rechazo por acta INCOMPLETA —
// la captura corta el papel aunque la cabecera sea legible.
const DETALLE_INCOMPLETA = "EL ACTA ESTÁ CORTADA EN EL ENCUADRE — ALÉJATE UN POCO Y CAPTURA EL ACTA COMPLETA";
// §D1 (SPEC-e14-score-ocr): modelo del score por RECONOCIMIENTO — techo de
// una foto SIN SEÑAL de contenido del acta (bolsa de papas, pared, borrosa
// total): por debajo de RECHAZADA (6.5) → «score bajo» garantizado. El
// detalle es el rechazo determinista §D3 (repetir, NUNCA RH en 1ª ronda).
const TECHO_SIN_SENAL = 4.9;
const DETALLE_BAJO = "NO SE RECONOCE INFORMACIÓN DEL ACTA — REPITA LA FOTO";
// D10 (SPEC-e14-guard-borde): techo del ESCUDO anti-fondo — el recorte trae
// fondo/sombra al filo (franjas ≥85% oscuras, NO tinta cortada): el acta pasa
// al gate pero NUNCA ÓPTIMA (statusDeScore: ≥8 sería ÓPTIMA — el operador
// puede preferir repetir porque el recorte trae fondo). Sin copy nuevo.
const TECHO_ESCUDO_FONDO = 7.9;

/**
 * §D1 (SPEC-e14-score-ocr): SEÑAL DE CONTENIDO del acta — se calcula DESPUÉS
 * del OCR + clasificación. El score del dueño mide el RECONOCIMIENTO («el
 * score se basa en el reconocimiento del acta por ocr y que el acta esté
 * completa»), no solo las métricas fotográficas. Señales: cabecera E-14 o
 * alguna lectura cruda del clasificador (MESA/tipo). `ocrTextIsValid` NO es
 * señal (la bolsa de papas lo pasa con texto ficticio del empaque).
 */
function senalDeContenido(texto: string, clasificacion: ClasificacionE14): boolean {
  const p = clasificacion.parciales;
  return (
    PATRON_CABECERA.test(texto) ||
    p?.cabecera === true ||
    (p?.mesa != null && Number.isFinite(p.mesa)) ||
    p?.tipo != null
  );
}

// GUARD-BORDE Rev. 2 (D1/D3): la función esActaCompleta del guard del PR #33
// (geometría: esquina al filo ≤0.001/≥0.999 o área <30% → INCOMPLETA) VIVIÓ
// aquí y hoy vive en ./completitud (verificarCompletitud) — la geometría
// pasó de CONDENAR a SER SOSPECHA: la condena exige tinta impresa cortada al
// filo del recorte (tabla de decisión §2 del spec). Historia completa del
// guard y su calibración: comentario del helper + CHANGES 0-decimoquinto.
// PATRON_CABECERA vive ahora en ./clasificador (§4.5: se mantiene como
// constante para traza/log — ya NO decide sola el estado del gate).

/** §D8.3 (SPEC-e14-score-ocr Rev. 3): quad IDENTIDAD — «el recorte es la
 *  foto entera». Con sinRecorte la detección de bordes NO corre y el quad
 *  (fracciones 0-1 de la foto) cubre TODO el encuadre: se imprime en el log
 *  como hoy (traza de auditoría) y alimenta el editor (recorte manual real
 *  sobre la foto completa) y revelar/filtros (mismo quad). */
const QUAD_IDENTITY: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Grab del <video> a RESOLUCIÓN DEL STREAM (§5 CAMARA): canvas de
 * videoWidth×videoHeight → JPEG 0.92. Síncrono (~10 ms) — se llama ANTES de
 * que el visor se desmonte, mientras el stream sigue vivo.
 */
function capturarFrame(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}

/** Entrada del pipeline: File (ARCHIVO o foto CÁMARA) o dataUrl ya crudo.
 *  §D8.2 (SPEC-e14-score-ocr Rev. 3): el flag «sin recorte automático» viaja
 *  con el ASSET de SIMULACIÓN dentro de la entrada (parámetro interno
 *  privado — OpcionesEscaneo queda INTACTO, nada público nuevo). */
type EntradaPipeline = { archivo: File; sinRecorte?: boolean } | { dataUrl: string };

/**
 * SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
 * §G-2 (SPEC-camara-funcional): ciclo determinista de las 3 actas del dueño
 * (óptima → intermedia → baja → óptima…) — cada disparo consume el índice
 * actual y avanza el contador de módulo. Mismo camino que IMPORTAR: File →
 * fileToCaptureDataUrl (F-IMPORT: EXIF/12MP). Caché POR ÍNDICE a nivel de
 * módulo para no re-descargar un acta ya servida en el ciclo.
 * §D8.1 (SPEC-e14-score-ocr Rev. 3): flag «sin recorte» por ENTRADA — el
 * flag viaja con el ASSET, no con el chip (el ciclo rotativo §G lo hereda
 * automáticamente): [0] óptima = pipeline completo (hoy) · [1] b/n as-is ·
 * [2] borrosa as-is.
 */
interface ActaSim {
  src: typeof actaSimUrl;
  nombre: string;
  sinRecorte: boolean;
}
const ACTAS_SIM: readonly ActaSim[] = [
  { src: actaSimUrl, nombre: "acta-e14-real.jpg", sinRecorte: false },
  { src: actaSimIntermediaUrl, nombre: "acta-sim-intermedia.jpg", sinRecorte: true },
  { src: actaSimBajaUrl, nombre: "acta-sim-baja.jpg", sinRecorte: true },
];
let actaSimIdx = 0;
interface EntradaSim {
  archivo: File;
  sinRecorte: boolean;
}
const actasSimCache: EntradaSim[] = [];
async function fetchActaSimulada(): Promise<EntradaSim> {
  const idx = actaSimIdx;
  actaSimIdx = (actaSimIdx + 1) % ACTAS_SIM.length;
  const cache = actasSimCache[idx];
  if (cache) return cache;
  // ACTAS_SIM[idx].src es StaticImageData — .src.src ya resuelve el basePath
  // /web-scanner del deploy estático (en dev: /_next/static/media/...).
  const res = await fetch(ACTAS_SIM[idx].src.src);
  if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
  // File con nombre real del asset (.jpg — evita el camino HEIC).
  const entrada: EntradaSim = {
    archivo: new File([await res.blob()], ACTAS_SIM[idx].nombre, {
      type: "image/jpeg",
    }),
    sinRecorte: ACTAS_SIM[idx].sinRecorte,
  };
  actasSimCache[idx] = entrada;
  return entrada;
}

/**
 * §D3 (SPEC-e14-simulacion-scores): asset FIJO por score de chip — mapeo
 * determinista dueño (la completa = óptima · la cortada = intermedio · la
 * borrosa = bajo): 8.2 → acta-e14-real.jpg · 7.0 → acta-sim-intermedia.jpg ·
 * 4.3 → acta-sim-baja.jpg. Reutiliza la MISMA caché por índice del ciclo
 * rotativo (§G del PR #33, que queda INTACTO — esta vía solo cambia QUÉ
 * índice se sirve: el del chip, nunca el contador rotativo). El flag
 * sinRecorte del asset viaja con la entrada (§D8.1).
 */
function indiceActaPorScore(score: number): number {
  if (score >= 8) return 0; // ÓPTIMA [8.2] → la acta completa, nítida
  if (score >= 6.5) return 1; // MEDIO [7.0] → la b/n del dueño, as-is (Rev. 3)
  return 2; // BAJA [4.3] → la borrosa del dueño, as-is (Rev. 3)
}
async function fetchActaSimPorScore(score: number): Promise<EntradaSim> {
  const idx = indiceActaPorScore(score);
  const cache = actasSimCache[idx];
  if (cache) return cache;
  const res = await fetch(ACTAS_SIM[idx].src.src);
  if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
  const entrada: EntradaSim = {
    archivo: new File([await res.blob()], ACTAS_SIM[idx].nombre, {
      type: "image/jpeg",
    }),
    sinRecorte: ACTAS_SIM[idx].sinRecorte,
  };
  actasSimCache[idx] = entrada;
  return entrada;
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

// §X (SPEC-score-legible): pisos de legibilidad.
const PISO_CONTRASTE_LEGIBLE = 80; // ≈ excellentQuality().contrast=84 del core
const PISO_IDENTIFICADA = 10;      // §X.3 (SPEC-score-10-identificada): identificada AUTO =
                                   // acta legible y digitalizada con certeza total → puntaje
                                   // perfecto (petición del dueño). El score deja de describir
                                   // el crudo y describe la CERTEZA de la digitalización.

/** §X.1 (SPEC-score-legible): contraste efectivo — una foto de documento
 *  (papel blanco ~85 % del encuadre) tiene dispersión global de luminancia
 *  BAJA POR DISEÑO aunque la tinta sea nítida (evidencia §0.2: metricas=
 *  {sharpness:80 brightness:95 contrast:22} → 6.7 MODERADA de un acta
 *  clasificada AUTO). El contraste global del CRUDO no es evidencia de
 *  ilegibilidad cuando el OCR leyó texto válido → piso de acta legible.
 *  El OCR manda (principio §4.2 extendido). */
function contrasteEfectivoDe(q: PageQuality, ocrLegible: boolean): number {
  return ocrLegible ? Math.max(q.contrast, PISO_CONTRASTE_LEGIBLE) : q.contrast;
}

/** Mapeo §4.1: PageQuality del core → score 0-10 (1 decimal) con techos por
 *  level. §X (SPEC-score-legible): recibe señales de legibilidad — OCR válido
 *  y clasificación AUTO (identificación completa). §D1 (SPEC-e14-score-ocr):
 *  `conSenal` extiende el paquete — SIN señal de contenido del acta el score
 *  no describe una digitalización → techo 4.9 («score bajo»). */
function scoreDeCalidad(
  q: PageQuality,
  senales?: { ocrLegible: boolean; identificada: boolean; conSenal?: boolean },
): number {
  const contrasteEf = contrasteEfectivoDe(q, senales?.ocrLegible ?? false);
  const bruto = (q.sharpness * 0.4 + q.brightness * 0.3 + contrasteEf * 0.3) / 10;
  let score10 = Math.round(bruto * 10) / 10;
  let level = q.level;
  if (contrasteEf !== q.contrast) {
    // Fuente: packages/scanner-core/src/image-processor.ts evaluateQuality —
    // fórmula y umbrales del level DUPLICADAS aquí (packages/ es intocable,
    // regla de oro) SOLO para recalcular el techo con el contraste efectivo.
    const scoreCore = q.sharpness * 0.45 + q.brightness * 0.25 + contrasteEf * 0.3;
    level =
      scoreCore >= 80 ? "excellent" : scoreCore >= 62 ? "good" : scoreCore >= 45 ? "fair" : "poor";
  }
  if (level === "fair") score10 = Math.min(score10, 7.9); // techo ADVERTENCIA
  if (level === "poor") score10 = Math.min(score10, 6.4); // techo RECHAZADA
  // §D1 (SPEC-e14-score-ocr): techo SIN SEÑAL de contenido — ANTES del piso
  // de identificada (no colisiona: AUTO exige tipo leído → implica señal).
  // Fórmulas/techos/piso existentes BYTE A BYTE intactos (§7 prohibido).
  if (senales && !senales.conSenal) score10 = Math.min(score10, TECHO_SIN_SENAL);
  // §X.2 piso por IDENTIFICACIÓN — ÚLTIMO (manda sobre los techos): una
  // clasificación AUTO (jerarquía divipol validada + mesa ≤ countTable + tipo)
  // es evidencia directa de legibilidad → el acta identificada nunca queda en
  // MODERADA ni RECHAZADA por métricas globales del crudo. SUGERIDA/MANUAL NO
  // reciben piso: el panel de corrección (§5) sigue siendo su camino.
  // §X.3 (SPEC-score-10-identificada): el piso es 10 — la identificación
  // completa es la evidencia MÁXIMA de legibilidad → puntaje perfecto.
  if (senales?.identificada) score10 = Math.max(score10, PISO_IDENTIFICADA);
  return score10;
}

/** Resultado del gate §4 (evaluarGate) — status + rechazo + clasificación. */
interface ResultadoGate {
  status: ActaStatus;
  rechazo: Acta["rechazo"];
  clasificacion: ClasificacionE14 | null;
}

/** Traza §4.6: clasif={dep:88,mun:335,zon:05,std:02,mesa:001,tipo:T,nivel:AUTO}. */
function fmtClasif(c: ClasificacionE14 | null): string {
  if (!c) return "sin-clasificar";
  const tipo = c.tipo === "TRANSMISION" ? "T" : c.tipo === "DELEGADOS" ? "D" : "-";
  return (
    `dep:${c.departamento?.codigo ?? "?"},mun:${c.municipio?.codigo ?? "?"},` +
    `zon:${c.zona?.codigo ?? "?"},std:${c.puesto?.codigo ?? "?"},` +
    `mesa:${c.mesa !== null ? String(c.mesa).padStart(3, "0") : "?"},` +
    `tipo:${tipo},nivel:${c.nivel}`
  );
}

/**
 * Emite progreso INTERPOLADO mientras una espera real del core está en vuelo
 * (decode/detect/proceso no exponen avance interno; el OCR sí lo reporta
 * real). La fracción se cap al 95% para que la resolución de la etapa
 * siempre produzca un salto visible en ANALIZANDO.
 */
function conRampa<T>(
  promesa: Promise<T>,
  msEstimados: number,
  evento: (fraccion: number) => ProgresoAnalisis,
  emitir: (p: ProgresoAnalisis) => void,
): Promise<T> {
  const inicio = performance.now();
  const timer = setInterval(() => {
    const f = Math.min(1, (performance.now() - inicio) / msEstimados);
    emitir(evento(f * 0.95));
  }, 140);
  return promesa.then(
    (valor) => {
      clearInterval(timer);
      return valor;
    },
    (error) => {
      clearInterval(timer);
      throw error;
    },
  );
}

export class RealCoreBridge implements E14Bridge {
  private contador = 0;

  async escanearActa(opciones: OpcionesEscaneo): Promise<Acta> {
    // Resolución de la entrada (L3 §5 CAMARA + F1 SIMULACIÓN):
    //  · CAMARA + archivo (ZSL/captureSmart/iOS) → MISMO pipeline que ARCHIVO.
    //  · CAMARA sin archivo + frameActual (video vivo) → grab síncrono.
    //  · SIMULACIÓN sin archivo (D35) → el acta E-14 incluida, EXACTAMENTE
    //    como un archivo de IMPORTAR (la foto real del dueño, EXIF incluido).
    //  · Sin entrada → error explícito (el guard del store ya avisó).
    let entrada: EntradaPipeline | null = null;
    if (opciones.archivo) {
      entrada = { archivo: opciones.archivo };
    } else if (opciones.fuente === "CAMARA") {
      const video = opciones.frameActual;
      const dataUrl = video && video.readyState >= 2 && video.videoWidth
        ? capturarFrame(video)
        : null;
      if (!dataUrl) {
        throw new Error("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)");
      }
      entrada = { dataUrl };
    } else if (opciones.fuente === "SIMULACION") {
      // SIMULACIÓN = pipeline real sobre el acta E-14 incluida (D35).
      // Mismo camino que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP).
      // §D3 (SPEC-e14-simulacion-scores): con `simular` el asset es el FIJO de
      // la banda del chip (determinista) — el ciclo rotativo §G queda intacto
      // para el disparo normal de la fuente. §D8.2 (Rev. 3): el flag
      // sinRecorte del asset viaja con la entrada (parámetro interno privado).
      const sim =
        opciones.simular && opciones.scoreSimulado != null
          ? await fetchActaSimPorScore(opciones.scoreSimulado)
          : await fetchActaSimulada();
      entrada = { archivo: sim.archivo, sinRecorte: sim.sinRecorte };
    } else {
      throw new Error("SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)");
    }

    // Acumulador de lo que ya se tiene (el acta de timeout rellena lo que
    // alcance a conocer — p. ej. fotoOriginal si el decode alcanzó a correr).
    const parcial: { fotoOriginal?: string } = {};
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) opciones.onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve un acta RECHAZADA
        // controlada (el toast crit sale del flujo normal del store).
        resolve(
          this.construirActa(opciones, parcial, {
            score: 0,
            status: "RECHAZADA",
            rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          }),
        );
      }, TIMEOUT_MS);

      this.pipeline(opciones, entrada, parcial, emitir).then(
        (acta) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(acta);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** Pipeline §5 (ARCHIVO y CAMARA comparten etapas y mapeo; ms por etapa en consola). */
  private async pipeline(
    opciones: OpcionesEscaneo,
    entrada: EntradaPipeline,
    parcial: { fotoOriginal?: string },
    emitir: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    const ms = { decode: 0, detect: 0, proceso: 0, calidad: 0, ocr: 0, total: 0 };
    const inicio = performance.now();

    // 1) Entrada → data URL crudo (F-IMPORT del core: HEIC/EXIF/12MP seguros;
    //    en CAMARA sin archivo el dataUrl ya vino del grab del <video>).
    emitir({ etapa: "DETECTANDO", progreso: 0 });
    const fotoOriginal =
      "archivo" in entrada
        ? await conRampa(
            fileToCaptureDataUrl(entrada.archivo),
            700,
            (f) => ({ etapa: "DETECTANDO", progreso: f * 0.5 }),
            emitir,
          )
        : entrada.dataUrl;
    ms.decode = performance.now() - inicio;
    parcial.fotoOriginal = fotoOriginal;

    // 2) Detección de bordes (worker OpenCV → fallback Sobel del core).
    //    §D8.3 (SPEC-e14-score-ocr Rev. 3): con sinRecorte la detección NO
    //    corre — «el recorte es la foto entera»: QUAD_IDENTITY (se imprime
    //    en el log como hoy, traza de auditoría). SOLO alcanzable desde la
    //    rama SIMULACIÓN (ARCHIVO/CÁMARA corren detect byte a byte, AC15).
    const sinRecorte = "archivo" in entrada && entrada.sinRecorte === true;
    let quad: Quad;
    const tDetect = performance.now();
    if (sinRecorte) {
      quad = QUAD_IDENTITY;
    } else {
      try {
        quad = await conRampa(
          detectDocumentEdges(fotoOriginal),
          900,
          (f) => ({ etapa: "DETECTANDO", progreso: 0.5 + f * 0.4 }),
          emitir,
        );
      } catch {
        // El core SIEMPRE devuelve Quad; una EXCEPCIÓN aquí = imagen no
        // detectable → RECHAZADA ILEGIBLE inmediata (§5 paso 1, spec §7.5).
        // El piso escénico D16 de ANALIZANDO completa la animación solo.
        return this.construirActa(opciones, parcial, {
          score: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
        });
      }
    }
    ms.detect = performance.now() - tDetect;
    emitir({ etapa: "DETECTANDO", progreso: 1 });

    // GUARD-BORDE Rev. 2 (§3b, D1/D3/D4): la señal de ACTA COMPLETA ya NO se
    // decide aquí con la geometría (el falso positivo del dueño: quad al filo
    // con la imagen perfecta — score 6.4). El cálculo se MUEVE a DESPUÉS del
    // paso 3 (recorte): la condena exige analizar la TINTA del recorte al
    // filo («la geometría sospecha, la tinta condena»). Helper ÚNICO
    // verificarCompletitud (AC11) — con `simular` la verificación SE OMITE
    // (completa = true forzado): la foto del chip MEDIO ES una acta cortada a
    // propósito y jamás debe caer INCOMPLETA desde un chip (AC3/AC6 de
    // simulacion-scores; AC7 del guard).

    // 3) Recorte + realce (warp real INTER_CUBIC + filtro default "bw").
    //    §D8.3 (SPEC-e14-score-ocr Rev. 3): con sinRecorte se OMITE
    //    processImage — fotoProcesada = fotoOriginal (sin warp, sin filtro
    //    "bw", sin realce: la b/n del dueño YA trae su filtro · la borrosa
    //    queda original), motor "canvas" (solo traza) y el acta nace con
    //    filtro "original" (veracidad en el editor — al elegir B/N aplica
    //    sobre la foto completa). Los ramps RECORTANDO/REALZANDO se
    //    CONSERVAN (misma animación de ANALIZANDO — la etapa resuelve al
    //    instante). El editor (recortar/cambiarFiltro) sigue operando normal
    //    con quadDetectado = identidad.
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    let fotoProcesada: string;
    let filtroActa: PageFilter;
    let motor: "worker" | "canvas";
    if (sinRecorte) {
      fotoProcesada = fotoOriginal;
      filtroActa = "original";
      motor = "canvas";
      emitir({ etapa: "REALZANDO", progreso: 1 });
    } else {
      const resultado = await conRampa(
        // Fuente: apps/scanner-lab/src/components/scanner/CameraView.tsx L602-604
        // (captura arranca en B/N adaptativo) + types.ts L50 (default del
        // producto) — D36: e14 no tiene ajustes → el default fijo es "bw".
        processImage(fotoOriginal, quad, "bw"),
        1400,
        // RECORTANDO .2→.6 (warp) → REALZANDO .4→1 (enhance), interpolado.
        (f) =>
          f < 0.55
            ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
            : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
        emitir,
      );
      ms.proceso = performance.now() - tProceso;
      emitir({ etapa: "REALZANDO", progreso: 1 });
      fotoProcesada = resultado.processed;
      filtroActa = "bw";
      motor = resultado.precision?.engine ?? "canvas";
    }
    // GUARD-BORDE Rev. 2 (§3b): la verificación de completitud corre DESPUÉS
    // del paso 3 — fotoProcesada ya existe (la tinta al filo se mide SOBRE el
    // recorte, no sobre la foto cruda). Helper ÚNICO (D3/AC11). El análisis
    // SOLO arranca si la geometría sospecha (D4: quad sano → costo cero) y
    // vuela EN PARALELO con CALIDAD/OCR: se espera justo antes del gate
    // (presupuesto propio <30 ms p95 — §3d/AC9). Con `simular` NO corre
    // (completa = true forzado — AC7). Nota sinRecorte: SOLO alcanzable desde
    // la rama SIMULACIÓN (AC15 score-ocr) → también cubierto por el skip.
    const verificacion: Promise<ResultadoCompletitud> | null = opciones.simular
      ? null
      : verificarCompletitud(quad, fotoProcesada);
    // §D4 (SPEC-e14-score-ocr): visor nunca vacío — tinta de la PROCESADA
    // (muestreo 64×64): un warp sin tinta (quad degenerado sobre superficie
    // lisa → blanco puro del B/N adaptativo) marca el acta para que REVISIÓN
    // muestre la ORIGINAL con su nota. Con tinta (aunque poca, p. ej. la
    // borrosa B/N) se muestra la procesada como hoy — sin regresión.
    const procesadaVacia = await procesadaVaciaDataUrl(fotoProcesada);

    // 4) Calidad de la página (Laplaciano + contraste + brillo sobre el crudo).
    emitir({ etapa: "CALIDAD", progreso: 0 });
    const tCalidad = performance.now();
    const calidad = await evaluateQuality(fotoOriginal);
    ms.calidad = performance.now() - tCalidad;
    emitir({ etapa: "CALIDAD", progreso: 1 });

    // 5) OCR sobre la PROCESADA (spa+eng local; progreso real 0→1).
    const tOcr = performance.now();
    const texto = await requestOcr(fotoProcesada, (p) => {
      emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
    });
    ms.ocr = performance.now() - tOcr;
    emitir({ etapa: "OCR", progreso: 1 });
    ms.total = performance.now() - inicio;

    // (motor/filtroActa calculados en el paso 3 — §D8.3: as-is → "canvas"/"original")

    // 6) Mapeo §4 → status/score/rechazo + clasificación de cabecera
    //    (SPEC-cabecera-clasificacion §4: RECHAZADA solo por CALIDAD;
    //    cabecera sin clasificar → EN_REVISION_HUMANA con panel, NUNCA rechazo).
    //    §X (SPEC-score-legible): la clasificación se calcula PRIMERO (barata:
    //    regex + divipol cacheada) y alimenta el score — el OCR y la
    //    identificación manda sobre las métricas globales del crudo.
    const clasificacion = clasificarCabecera(texto, await cargarDivipol());
    const ocrLegible = ocrTextIsValid(texto);
    // §D1 (SPEC-e14-score-ocr): señal de CONTENIDO del acta — alimenta el
    // score (techo 4.9 sin señal) y el desenlace §D3 (rechazo BAJO).
    const senalActa = senalDeContenido(texto, clasificacion);
    let score = scoreDeCalidad(calidad, {
      ocrLegible,
      identificada: clasificacion.nivel === "AUTO",
      conSenal: senalActa,
    });
    // §D3 (SPEC-e14-simulacion-scores): inyección determinista del chip —
    // reemplaza el calculado DESPUÉS de scoreDeCalidad y ANTES del gate. El
    // piso de identificada §X.3 RE-APLICA SOLO en la banda óptima (§D6.3
    // SPEC-e14-score-ocr Rev. 3: `scoreSimulado >= 8` — la foto b/n del MEDIO
    // clasifica AUTO real y sin esta condición el piso la subiría a 10.0
    // ÓPTIMA y la banda medio moriría; el chip manda: 7.0 → ADVERTENCIA).
    // La óptima sí se identifica: 8.2 + AUTO → 10.0 — AC2/AC13; sin AUTO el
    // score inyectado llega limpio al gate (7.0 → ADVERTENCIA · 4.3 →
    // RECHAZADA, §D4). Capturas REALES: piso INTACTO (la guarda vive SOLO
    // dentro de este if simular). Nada se fuerza a mano: `evaluarGate` decide.
    if (opciones.simular && opciones.scoreSimulado != null) {
      score = opciones.scoreSimulado;
      if (clasificacion.nivel === "AUTO" && opciones.scoreSimulado >= 8) {
        score = Math.max(score, PISO_IDENTIFICADA);
      }
    }
    // §F-2 (SPEC-camara-funcional) + GUARD-BORDE Rev. 2: acta INCOMPLETA →
    // resolución por la vía de rechazo SIN tocar evaluarGate (el veto sigue
    // VIVIENDO FUERA del gate — §7 score-ocr intocado, D6/AC10; el piso de
    // identificada solo beneficia a actas COMPLETAS — en la práctica anulado
    // por el techo 6.4 del veto, mismo que «poor"). La decisión del guard
    // llega aquí: la sospecha geométrica SOLO condena con tinta cortada al
    // filo del recorte (D1 — el falso positivo del quad al filo con imagen
    // perfecta queda curado). El resto del pipeline corrió igual
    // (recorte/calidad/OCR) para que REVISIÓN muestre la imagen y el
    // operador entienda el problema.
    const verificacionResuelta = verificacion ? await verificacion : null;
    const completa = opciones.simular ? true : (verificacionResuelta?.completa ?? true);
    // D10 — escudo anti-fondo: franja(s) ≥85% oscura(s) al filo = fondo/sombra
    // incluida por el warp (NO tinta cortada) → el acta pasa al gate con
    // TECHO 7.9 (nunca ÓPTIMA — statusDeScore: ≥8; el recorte trae fondo y el
    // operador puede preferir repetir) sin copy nuevo. SOLO actas completas
    // (la condenada por tinta no llega al gate).
    if (completa && verificacionResuelta?.fondo) {
      score = Math.min(score, TECHO_ESCUDO_FONDO);
    }
    const gate: ResultadoGate = completa
      ? this.evaluarGate(score, texto, clasificacion, opciones.intento, opciones.maxIntentos)
      : {
          // intento < maxIntentos → RECHAZADA · al AGOTAR → contingencia
          // automática C4 (EN_REVISION_HUMANA con el MISMO rechazo).
          status:
            opciones.intento >= opciones.maxIntentos
              ? ("EN_REVISION_HUMANA" as ActaStatus)
              : ("RECHAZADA" as ActaStatus),
          rechazo: { tipo: "INCOMPLETA", detalle: DETALLE_INCOMPLETA },
          clasificacion: null,
        };
    if (!completa) score = Math.min(score, 6.4);

    // §D3 (SPEC-e14-score-ocr): desenlace «SCORE BAJO» determinista — sin
    // señal de contenido, el rechazo se sustituye por BAJO SEA CUAL SEA el
    // status (el status lo sigue decidiendo el gate/los intentos: al agotar,
    // contingencia C4 con su rechazo BAJO real). Con señal, nada cambia
    // (INCOMPLETA/ILEGIBLE/GENERICO como hoy). Mismo patrón que INCOMPLETA:
    // FUERA de evaluarGate (§7 prohibido tocarlo).
    const rechazoFinal: Acta["rechazo"] = senalActa
      ? gate.rechazo
      : { tipo: "BAJO", detalle: DETALLE_BAJO };

    const evidenciaSim =
      opciones.simular && opciones.scoreSimulado != null ? ` sim=${opciones.scoreSimulado}` : "";
    // §D8.3: traza de auditoría del as-is (solo cuando sinRecorte).
    const evidenciaAsis = sinRecorte ? " recorte=as-is" : "";
    // §3c (GUARD-BORDE) — log de auditoría del guard: SOLO cuando hubo
    // sospecha geométrica se añaden los campos nuevos (AC8: sin sospecha el
    // log queda como hoy). `borde=` lados sospechosos ("S|E"), `tintaFilo=`
    // condena, `franja=` densidades de tinta en % por lado sospechoso (mismo
    // orden que borde) y `fondo=` escudo D10.
    const evidenciaBorde =
      verificacionResuelta && verificacionResuelta.sospecha
        ? ` borde=${verificacionResuelta.sospecha}` +
          ` tintaFilo=${verificacionResuelta.tintaFilo}` +
          ` franja=[${verificacionResuelta.densidades.map((d) => d.toFixed(1)).join(",")}]` +
          ` fondo=${verificacionResuelta.fondo}`
        : "";
    console.info(
      `[e14] pipeline ${opciones.fuente}/${"archivo" in entrada ? "file" : "video-grab"} ` +
        `total=${Math.round(ms.total)}ms ` +
        `(decode=${Math.round(ms.decode)} detect=${Math.round(ms.detect)} ` +
        `proceso=${Math.round(ms.proceso)} calidad=${Math.round(ms.calidad)} ` +
        `ocr=${Math.round(ms.ocr)} motor=${motor} ocrValido=${ocrTextIsValid(texto)} ` +
        `cabeceraE14=${PATRON_CABECERA.test(texto)} completa=${completa} ` +
        `senal=${senalActa} vacia=${procesadaVacia}${evidenciaAsis}${evidenciaBorde} ` +
        `quad=[${quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}] ` +
        `score=${score} filtro=${filtroActa} clasif={${fmtClasif(gate.clasificacion)}} ` +
        `metricas={sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
        `contrast:${calidad.contrast} contEff:${contrasteEfectivoDe(calidad, ocrLegible)} ` +
        `level:${calidad.level}})${evidenciaSim}`,
    );

    return this.construirActa(opciones, parcial, {
      fotoProcesada,
      procesadaVacia,
      quadDetectado: quad,
      calidad,
      ocrTexto: texto,
      motor,
      // §D8.3 (SPEC-e14-score-ocr Rev. 3): as-is nace "original" (veracidad
      // en el editor — el acta NO pasó por filtro); pipeline normal "bw".
      filtro: filtroActa,
      score,
      status: gate.status,
      rechazo: rechazoFinal,
      clasificacion: gate.clasificacion,
    });
  }

  /**
   * L5 (§7.5) — RECORTE MANUAL (rescate D20): re-ejecuta el pipeline §5 sobre
   * `fotoOriginal` con el quad del editor (F5-MANUAL: `manual: true` respeta
   * el quad al píxel, sin refine) y devuelve el acta ACTUALIZADA. El acta
   * conserva IDENTIDAD (fuente/intento/maxIntentos/paginación/título…) — el
   * rescate NO es una captura nueva, no consume intento. Timeout 15 s igual
   * que escanearActa: resuelve un acta RECHAZADA ILEGIBLE controlada.
   * F4/D37: `rotacionOverride` (4º parámetro) hornea la rotación LOCAL del
   * editor — el retorno de pipelineRecorte fija `rotation: rotacionUsada`.
   */
  recortar(
    acta: Acta,
    quad: Quad,
    onProgreso?: (p: ProgresoAnalisis) => void,
    rotacionOverride?: number,
  ): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      return Promise.reject(new Error("SIN FOTO ORIGINAL PARA RECORTAR"));
    }
    const rotacion = rotacionOverride ?? acta.rotation ?? 0;
    let vencido = false; // tras el timeout no se emite más progreso (§5)
    const emitir = (p: ProgresoAnalisis) => {
      if (!vencido) onProgreso?.(p);
    };

    return new Promise<Acta>((resolve, reject) => {
      const timer = setTimeout(() => {
        vencido = true;
        // §5: el timeout NO rechaza la Promise — resuelve el acta RECHAZADA
        // controlada (el toast sale del flujo normal del store).
        resolve({
          ...acta,
          score: 0,
          status: "RECHAZADA",
          rechazo: { tipo: "ILEGIBLE", detalle: DETALLE_TIMEOUT },
          firmas: this.firmasPorStatus(acta.firmas, "RECHAZADA"),
        });
      }, TIMEOUT_MS);

      void this.pipelineRecorte(acta, fotoOriginal, quad, rotacion, emitir).then(
        (actaNueva) => {
          if (vencido) return; // ya resolvió el timeout: el resultado se descarta
          clearTimeout(timer);
          resolve(actaNueva);
        },
        (error) => {
          if (vencido) return;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error("ERROR DE PIPELINE"));
        },
      );
    });
  }

  /** Pipeline §5 del RECORTE (sin decode/detección: la foto y el quad ya son
   *  conocidos). Reusa los helpers del pipeline L2 (conRampa, scoreDeCalidad,
   *  PATRON_CABECERA) y el mapeo §4.1 + gate §4.2 idénticos. */
  private async pipelineRecorte(
    acta: Acta,
    fotoOriginal: string,
    quad: Quad,
    rotacion: number,
    emitir: (p: ProgresoAnalisis) => void,
  ): Promise<Acta> {
    const ms = { proceso: 0, calidad: 0, ocr: 0, total: 0 };
    const inicio = performance.now();
    // F2/D36: el recorte conserva el filtro del acta (default del producto "bw").
    const filtro: PageFilter = acta.filtro ?? "bw";

    // 1) Recorte + realce (warp real INTER_CUBIC + filtro del acta, F5-MANUAL).
    emitir({ etapa: "RECORTANDO", progreso: 0.2 });
    const tProceso = performance.now();
    const resultado = await conRampa(
      processImage(fotoOriginal, quad, filtro, rotacion, { manual: true }),
      1400,
      // RECORTANDO .2→.6 (warp) → REALZANDO .4→1 (enhance), interpolado.
      (f) =>
        f < 0.55
          ? { etapa: "RECORTANDO", progreso: 0.2 + (f / 0.55) * 0.4 }
          : { etapa: "REALZANDO", progreso: 0.4 + ((f - 0.55) / 0.45) * 0.6 },
      emitir,
    );
    ms.proceso = performance.now() - tProceso;
    emitir({ etapa: "REALZANDO", progreso: 1 });
    const fotoProcesada = resultado.processed;
    // §D4 (SPEC-e14-score-ocr): tinta de la procesada re-recortada — mismo
    // criterio del pipeline (un crop sobre zona sin tinta → ORIGINAL).
    const procesadaVacia = await procesadaVaciaDataUrl(fotoProcesada);

    // 2) Calidad de la página (sobre el crudo — misma regla §5 paso 4).
    emitir({ etapa: "CALIDAD", progreso: 0 });
    const tCalidad = performance.now();
    const calidad = await evaluateQuality(fotoOriginal);
    ms.calidad = performance.now() - tCalidad;
    emitir({ etapa: "CALIDAD", progreso: 1 });

    // 3) OCR sobre la PROCESADA + gate §4.2 (progreso real 0→1).
    const tOcr = performance.now();
    const texto = await requestOcr(fotoProcesada, (p) => {
      emitir({ etapa: "OCR", progreso: Math.min(1, Math.max(0, p)) });
    });
    ms.ocr = performance.now() - tOcr;
    emitir({ etapa: "OCR", progreso: 1 });
    ms.total = performance.now() - inicio;

    const motor = resultado.precision?.engine ?? "canvas";

    // 4) Mapeo §4 → status/score/rechazo + clasificación (idéntico al
    //    escaneo — helper ÚNICO evaluarGate, §4.4: AMBOS pipelines con el
    //    MISMO criterio). §X (SPEC-score-legible): clasificación primero,
    //    score con señales de legibilidad.
    // §F-3 (SPEC-camara-funcional) + GUARD-BORDE Rev. 2 (D3/AC11): el quad
    // del editor está en coordenadas de `fotoOriginal` → la MISMA regla de
    // completitud ANTES del gate — el helper ÚNICO verificarCompletitud
    // (geometría sospecha, tinta condena: el rescate de un encuadre apretado
    // con filo limpio ya NO muere por geometría sola). El rescate NO sirve
    // de bypass: si el papel está cortado EN VERDAD (tinta al filo), ningún
    // crop lo completa; si el acta SÍ está entera (detección falló por
    // sombra), el recorte manual la rescata legítimamente.
    const verificacion = await verificarCompletitud(quad, fotoProcesada);
    const completa = verificacion.completa;
    const clasificacion = clasificarCabecera(texto, await cargarDivipol());
    const ocrLegible = ocrTextIsValid(texto);
    // §D1 (SPEC-e14-score-ocr): señal de contenido — mismo criterio §4.4
    // (helper único, AMBOS pipelines con el MISMO criterio).
    const senalActa = senalDeContenido(texto, clasificacion);
    let score = scoreDeCalidad(calidad, {
      ocrLegible,
      identificada: clasificacion.nivel === "AUTO",
      conSenal: senalActa,
    });
    // D10 — escudo anti-fondo (mismo criterio del escaneo): el rescate trae
    // fondo/sombra al filo → gate con TECHO 7.9 (nunca ÓPTIMA), sin copy.
    if (completa && verificacion.fondo) {
      score = Math.min(score, TECHO_ESCUDO_FONDO);
    }
    const gate: ResultadoGate = completa
      ? this.evaluarGate(score, texto, clasificacion, acta.intento, acta.maxIntentos)
      : {
          status:
            acta.intento >= acta.maxIntentos
              ? ("EN_REVISION_HUMANA" as ActaStatus)
              : ("RECHAZADA" as ActaStatus),
          rechazo: { tipo: "INCOMPLETA", detalle: DETALLE_INCOMPLETA },
          clasificacion: null,
        };
    if (!completa) score = Math.min(score, 6.4);
    // §D3 (SPEC-e14-score-ocr): sustitución BAJO sin señal — igual que el
    // escaneo (el recorte de una foto sin acta no fabrica señal).
    const rechazoFinal: Acta["rechazo"] = senalActa
      ? gate.rechazo
      : { tipo: "BAJO", detalle: DETALLE_BAJO };

    // §3c (GUARD-BORDE): log de auditoría del guard — SOLO con sospecha
    // geométrica (AC8). Mismos campos que el pipeline de escaneo.
    const evidenciaBordeRecorte =
      verificacion.sospecha
        ? ` borde=${verificacion.sospecha}` +
          ` tintaFilo=${verificacion.tintaFilo}` +
          ` franja=[${verificacion.densidades.map((d) => d.toFixed(1)).join(",")}]` +
          ` fondo=${verificacion.fondo}`
        : "";
    console.info(
      `[e14] recorte ${acta.fuente} total=${Math.round(ms.total)}ms ` +
        `(proceso=${Math.round(ms.proceso)} calidad=${Math.round(ms.calidad)} ` +
        `ocr=${Math.round(ms.ocr)} motor=${motor} ocrValido=${ocrTextIsValid(texto)} ` +
        `cabeceraE14=${PATRON_CABECERA.test(texto)} completa=${completa} ` +
        `senal=${senalActa} vacia=${procesadaVacia}${evidenciaBordeRecorte} ` +
        `quad=[${quad.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}] ` +
        `score=${score} filtro=${filtro} clasif={${fmtClasif(gate.clasificacion)}} ` +
        `metricas={sharpness:${calidad.sharpness} brightness:${calidad.brightness} ` +
        `contrast:${calidad.contrast} contEff:${contrasteEfectivoDe(calidad, ocrLegible)} ` +
        `level:${calidad.level}})`,
    );

    // Acta ACTUALIZADA: identidad intacta (spread), campos reales nuevos y
    // rechazo LIMPIO si el rescate mejora el estado (D20). F4/D37: la
    // rotación usada queda HORNEADA (rotation) — la respeta el PDF §6 y un
    // eventual re-recorte/filtrado.
    // §1.3 (SPEC-titulo-ubicacion): el recorte re-corre el gate → clasificación
    // AUTO nueva → título/ubicación reales. ADAPTACIÓN de nombre: el spec llama
    // `resultado` a esta constante, pero ese identificador ya vive arriba (el
    // `conRampa` del paso 1) → `actaActualizada` (misma forma, cero lógica nueva).
    const actaActualizada: Acta = {
      ...acta,
      fotoProcesada,
      procesadaVacia,
      quadDetectado: quad,
      rotation: rotacion,
      ocrTexto: texto,
      metricas: {
        sharpness: calidad.sharpness,
        brightness: calidad.brightness,
        contrast: calidad.contrast,
      },
      motor,
      score,
      status: gate.status,
      rechazo: rechazoFinal,
      clasificacion: gate.clasificacion ?? undefined,
      firmas: this.firmasPorStatus(acta.firmas, gate.status),
    };
    const titUbi = tituloYUbicacionDe(gate.clasificacion ?? null);
    if (titUbi) {
      actaActualizada.titulo = titUbi.titulo;
      actaActualizada.ubicacion = titUbi.ubicacion;
    }
    return actaActualizada;
  }

  /**
   * Gate §4.2 REVISADO (SPEC-cabecera-clasificacion §4 + §7.2 SPEC-rediseno-
   * revision) — helper ÚNICO para AMBOS pipelines (escaneo y recorte, §4.4):
   *  1. RECHAZADA SOLO por CALIDAD (score < 6.5 vía statusDeScore, §4.1) —
   *     la tarjeta «ACTA NO RECONOCIDA» queda reservada a este caso. Al
   *     AGOTAR intentos la contingencia es AUTOMÁTICA (C4, sin botón manual).
   *  2. Calidad suficiente + clasificación AUTO → status por score (OPTIMA/
   *     ADVERTENCIA) como hoy + clasificación persistida (Fase B al envío).
   *  3. Calidad suficiente + SUGERIDA/MANUAL (incluye OCR sin texto, §4.3) →
   *     EN_REVISION_HUMANA: la pantalla distingue por intento (§7.3 — «repetir-
   *     primero» antes de agotar; contingencia con panel al agotar).
   * PATRON_CABECERA ya NO decide el estado (§4.5) — solo traza en el log.
   * §X (SPEC-score-legible): la clasificación llega calculada desde el
   * pipeline — alimenta el score (piso por identificación).
   */
  private evaluarGate(
    score: number,
    ocrTexto: string,
    clasificacion: ClasificacionE14,
    intento: number,
    maxIntentos: number,
  ): ResultadoGate {
    if (score >= 6.5) {
      if (clasificacion.nivel === "AUTO") {
        return { status: statusDeScore(score), rechazo: null, clasificacion };
      }
      // SUGERIDA/MANUAL: la CONTINGENCIA (panel) llega SOLO al agotar intentos;
      // antes, el acta viaja como EN_REVISION_HUMANA «repetir-primero» (§7.3 —
      // la pantalla distingue por intento; el estado no cambia).
      return { status: "EN_REVISION_HUMANA", rechazo: null, clasificacion };
    }
    // score < 6.5 — rechazo por CALIDAD. Al AGOTAR intentos: contingencia
    // automática (C4) — el sistema escala solo, sin botón manual.
    if (intento >= maxIntentos) {
      return {
        status: "EN_REVISION_HUMANA",
        rechazo: ocrTextIsValid(ocrTexto)
          ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
          : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
        clasificacion: null,
      };
    }
    return {
      status: "RECHAZADA",
      rechazo: ocrTextIsValid(ocrTexto)
        ? { tipo: "GENERICO", detalle: DETALLE_GENERICO }
        : { tipo: "ILEGIBLE", detalle: DETALLE_ILEGIBLE },
      clasificacion: null,
    };
  }

  /**
   * F2 (§F2.2, D36) — FILTRO: re-procesa la foto con el filtro elegido,
   * IGUAL que setFilterOnPage del core (apps/scanner-lab/src/components/
   * scanner/…/store.ts L644-669): SOLO processImage — sin re-OCR, sin
   * re-calidad (el gate ya resolvió). Devuelve el acta con fotoProcesada y
   * filtro actualizados. Sin timeout: es un ÚNICO processImage con fallback
   * canvas (misma exposición al cuelgue que tiene el lab aquí — documentado
   * en worklog como ADAPTACIÓN de la opción «timeout 15 s» del spec).
   */
  async revelar(acta: Acta, filtro: PageFilter): Promise<Acta> {
    const fotoOriginal = acta.fotoOriginal;
    if (!fotoOriginal) {
      throw new Error("SIN FOTO ORIGINAL PARA FILTRAR");
    }
    // Fuente: apps/scanner-lab/…/store.ts L644-669 (setFilterOnPage) —
    // processImage(original, quad, filter, rotation, { manual }).
    const resultado = await processImage(
      fotoOriginal,
      acta.quadDetectado ?? defaultQuad(),
      filtro,
      acta.rotation ?? 0,
      { manual: true },
    );
    return { ...acta, fotoProcesada: resultado.processed, filtro };
  }

  /**
   * F-OCR del lab (EditorView.tsx L1360-1395): corre requestOcr sobre la
   * imagen PROCESADA del acta y devuelve el texto crudo.
   * ADAPTACIÓN documentada: el lab elige imagen con prioridad
   * `preview ?? procesada-fresca ?? original` (L1373-1376) porque tiene
   * previewCache; en e14 la procesada SIEMPRE está fresca (todo cambio pasa
   * por el pipeline) → se usa fotoProcesada directa. El guard `previewLoading`
   * (L1364-1370) NO aplica (no hay preview en e14) → omitido. Sin timeout
   * extra (igual que el lab L1379 — requestOcr se gobierna solo).
   */
  async reconocerTexto(acta: Acta): Promise<string> {
    const fotoProcesada = acta.fotoProcesada;
    if (!fotoProcesada) {
      throw new Error("SIN FOTO PROCESADA PARA RECONOCER TEXTO");
    }
    return requestOcr(fotoProcesada);
  }

  /** Firmas coherentes con el estado (misma regla del mock/§7.5):
   *  ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK. */
  private firmasPorStatus(firmas: ActaFirma[], status: ActaStatus): ActaFirma[] {
    if (firmas.length < 2) return firmas;
    const estadoFirma2: ActaFirma["estado"] =
      status === "ADVERTENCIA" ? "TENUE" : status === "RECHAZADA" ? "NO_DETECTADO" : "OK";
    return firmas.map((f, i) => (i === 1 ? { ...f, estado: estadoFirma2 } : { ...f }));
  }

  /** Acta final: seed SOLO cuando la clasificación no está resuelta (§1) + campos reales §3.1. */
  private construirActa(
    opciones: OpcionesEscaneo,
    parcial: { fotoOriginal?: string },
    campos: {
      fotoProcesada?: string;
      /** §D4 (SPEC-e14-score-ocr): la procesada salió sin tinta. */
      procesadaVacia?: boolean;
      quadDetectado?: Quad;
      calidad?: PageQuality;
      ocrTexto?: string;
      motor?: "worker" | "canvas";
      /** §D8.3 (SPEC-e14-score-ocr Rev. 3): filtro del acta al nacer —
       *  "original" cuando el asset sim corrió as-is, "bw" (default del
       *  producto) en el pipeline normal. */
      filtro?: PageFilter;
      score: number;
      status: ActaStatus;
      rechazo: Acta["rechazo"];
      /** Clasificación de cabecera (SPEC-cabecera-clasificacion §4/§6). */
      clasificacion?: ClasificacionE14 | null;
    },
  ): Acta {
    const numeroMesa = opciones.objetivo
      ? opciones.objetivo.mesaId.replace(/\D/g, "").padStart(3, "0")
      : "001";
    this.contador += 1;

    // Firmas coherentes con el estado (misma regla del mock §7.5):
    // ADVERTENCIA → firma 2 TENUE · RECHAZADA → NO_DETECTADO · resto OK.
    const estadoFirma2: ActaFirma["estado"] =
      campos.status === "ADVERTENCIA" ? "TENUE" : campos.status === "RECHAZADA" ? "NO_DETECTADO" : "OK";

    // §1.2 (SPEC-titulo-ubicacion): clasificación AUTO → el acta nace con
    // título/ubicación REALES; sin ella se conserva el seed (no se inventa).
    const titUbi = tituloYUbicacionDe(campos.clasificacion ?? null);
    return {
      id: `acta-${Date.now()}-${this.contador}`,
      titulo: titUbi?.titulo ?? ACTA_MOCK.titulo,
      ubicacion: titUbi?.ubicacion ?? {
        departamento: ACTA_MOCK.departamento,
        municipio: ACTA_MOCK.municipio,
        zona: ACTA_MOCK.zona,
        puesto: ACTA_MOCK.puesto,
        mesa: numeroMesa,
      },
      tipo: ACTA_MOCK.tipo,
      // §6: página REAL del «Ver/Pag/de» cuando la clasificación la leyó;
      // clasificación sin «Ver/Pag» → default P1/2 (mismo default del hueco
      // Fase B — coherencia display/archivo); sin clasificación → objetivo seed.
      pagina: campos.clasificacion
        ? (campos.clasificacion.pagina ?? { index: 1, total: 2 })
        : {
            index: opciones.objetivo?.pagina ?? 1,
            total: 2,
          },
      candidatos: ACTA_MOCK.candidatos.map((c) => ({ ...c })),
      firmas: [
        { nombre: ACTA_MOCK.firmas[0].nombre, jurado: ACTA_MOCK.firmas[0].jurado, estado: "OK" },
        { nombre: ACTA_MOCK.firmas[1].nombre, jurado: ACTA_MOCK.firmas[1].jurado, estado: estadoFirma2 },
        { nombre: ACTA_MOCK.firmas[2].nombre, jurado: ACTA_MOCK.firmas[2].jurado, estado: "OK" },
      ],
      codigoBarras: ACTA_MOCK.codigoBarras,
      score: campos.score,
      status: campos.status,
      rechazo: campos.rechazo,
      intento: opciones.intento,
      maxIntentos: opciones.maxIntentos,

      // ----- Campos reales (§3.1) -----
      fuente: opciones.fuente,
      fotoOriginal: parcial.fotoOriginal,
      fotoProcesada: campos.fotoProcesada,
      procesadaVacia: campos.procesadaVacia,
      ocrTexto: campos.ocrTexto,
      metricas: campos.calidad
        ? {
            sharpness: campos.calidad.sharpness,
            brightness: campos.calidad.brightness,
            contrast: campos.calidad.contrast,
          }
        : undefined,
      motor: campos.motor ?? "canvas",
      quadDetectado: campos.quadDetectado,
      rotation: 0,
      // F2/D36: default del producto (types.ts L50 del core) — toda captura
      // nace en B/N adaptativo (Fuente: CameraView.tsx L602-604 del lab).
      // §D8.3 (Rev. 3): EXCEPTO los assets sim as-is, que nacen "original".
      filtro: campos.filtro ?? ("bw" as PageFilter),
      // SPEC-cabecera-clasificacion §6: clasificación de cabecera (AUTO →
      // archivada al envío; SUGERIDA/MANUAL → panel de corrección §5).
      clasificacion: campos.clasificacion ?? undefined,
    };
  }

  horaEnvio(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
  }

  horaHistorial(): string {
    const d = new Date();
    return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
  }
}
