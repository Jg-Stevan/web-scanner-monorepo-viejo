/**
 * PLAN B (B2 + §6) — Ruta de decodificación WebCodecs (ImageDecoder).
 *
 * Blob → ImageDecoder → ImageBitmap SIN <img> ni canvas 2D en el hilo
 * principal (la decodificación JPEG/PNG de 12–27 MP ocurre dentro del
 * compositor de Chrome, fuera del hilo de la UI).
 *
 * CORRECTITUD EXIF: ImageDecoder NO aplica la orientación EXIF (entrega los
 * píxeles crudos del sensor), mientras que <img> SÍ la aplica. Esta ruta lee
 * el tag de orientación del blob y aplica la MISMA transformación que el
 * navegador aplicaría al pintar (equivalencia exacta con main; el coste es
 * UN drawImage a canvas solo cuando la orientación ≠ 1).
 *
 * Fallback POR LLAMADA (no global): cualquier fallo → null → el llamador usa
 * su ruta actual (<img>/createImageBitmap) intacta.
 *
 * §6 — supersampleBlobToStandardCap: downscale >4032 → 4032 en UN PASO con
 * filtro de calidad (createImageBitmap resizeQuality:'high'), nunca en
 * múltiples pasos. Es LA pregunta del experimento (nitidez 6000→4032 vs
 * nativa 4032).
 */

import { qaEmptyCapsForced, setHiResTelemetry } from "./tech-capabilities";

// ─── Tipos estructurales mínimos (sin dependencias npm — regla 9) ───────────

interface ImageDecoderLike {
  decode(opts: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
  readonly completed: boolean;
  readonly tracks: { ready: Promise<unknown> };
}

type ImageDecoderCtor = new (opts: {
  data: BufferSource;
  type: string;
  preferAnimation?: boolean;
}) => ImageDecoderLike;

function getImageDecoderCtor(): ImageDecoderCtor | null {
  try {
    const ctor = (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder;
    return typeof ctor === "function" ? (ctor as ImageDecoderCtor) : null;
  } catch {
    return null;
  }
}

/** ¿ImageDecoder (WebCodecs) disponible? (sync — para gates por llamada).
 *  B5: con el flag QA de caps vacías la ruta queda APAGADA (app = main). */
export function webcodecsDecodeAvailable(): boolean {
  if (qaEmptyCapsForced()) return false;
  return getImageDecoderCtor() !== null;
}

// ─── Lector EXIF (tag 0x0112 — orientation) ─────────────────────────────────

/**
 * Lee la orientación EXIF (1..8) de un JPEG. 1 / null = sin rotación.
 * Parseo mínimo del APP1: SOI → APP1 «Exif\0\0» → TIFF (II/MM) → IFD0.
 */
export function readExifOrientation(bytes: Uint8Array): number {
  try {
    if (bytes.length < 12) return 1;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1; // no es JPEG
    let off = 2;
    while (off + 4 <= bytes.length) {
      const marker = bytes[off]!;
      const tag = bytes[off + 1]!;
      if (marker !== 0xff) return 1;
      if (tag === 0xda || tag === 0xd9) return 1; // SOS/EOI: no hay APP1
      const size = (bytes[off + 2]! << 8) | bytes[off + 3]!;
      if (tag === 0xe1) {
        // APP1: ¿«Exif\0\0»?
        const head = off + 4;
        if (
          size >= 8 &&
          bytes[head] === 0x45 && // E
          bytes[head + 1] === 0x78 && // x
          bytes[head + 2] === 0x69 && // i
          bytes[head + 3] === 0x66 && // f
          bytes[head + 4] === 0x00 &&
          bytes[head + 5] === 0x00
        ) {
          return parseTiffOrientation(bytes, head + 6, bytes.length);
        }
      }
      if (size < 2) return 1;
      off += 2 + size;
    }
    return 1;
  } catch {
    return 1;
  }
}

function parseTiffOrientation(b: Uint8Array, tiff: number, end: number): number {
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49; // «II» little-endian
  const u16 = (o: number) => (le ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!);
  const u32 = (o: number) =>
    le
      ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
      : ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  if (u16(tiff + 2) !== 42) return 1; // TIFF magic
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return 1;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

// ─── Transformación EXIF (las mismas matrices del navegador) ────────────────

/**
 * Aplica la orientación EXIF a un ImageBitmap con UN drawImage a canvas
 * (solo cuando orientation ≠ 1). Matrices canónicas de setTransform:
 *   2:[-1,0,0,1] · 3:[-1,0,0,-1] · 4:[1,0,0,-1] · 5:[0,1,1,0]
 *   6:[0,1,-1,0] · 7:[0,-1,-1,0] · 8:[0,-1,1,0]  (5–8 intercambian w/h).
 */
async function applyExifOrientation(
  bm: ImageBitmap,
  orientation: number
): Promise<ImageBitmap> {
  const w = bm.width;
  const h = bm.height;
  const swap = orientation >= 5;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return bm; // sin contexto: el bitmap original (el llamador decide)
  ctx.imageSmoothingQuality = "high";
  const W = canvas.width;
  const H = canvas.height;
  switch (orientation) {
    case 2:
      ctx.setTransform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.setTransform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.setTransform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.setTransform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.setTransform(0, 1, -1, 0, h, 0);
      break;
    case 7:
      ctx.setTransform(0, -1, -1, 0, h, w);
      break;
    case 8:
      ctx.setTransform(0, -1, 1, 0, 0, w);
      break;
    default:
      ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  void W;
  void H;
  ctx.drawImage(bm, 0, 0);
  bm.close();
  return createImageBitmap(canvas);
}

// ─── B2 — decodificación WebCodecs ──────────────────────────────────────────

function sniffMime(blob: Blob, bytes: Uint8Array): string {
  if (blob.type && blob.type !== "application/octet-stream") return blob.type;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  return "";
}

/**
 * Blob → ImageDecoder → ImageBitmap (con orientación EXIF aplicada).
 * Devuelve null ante CUALQUIER fallo (formato, OOM, datos corruptos…) —
 * el llamador cae a su ruta actual. Nunca lanza.
 */
export async function decodeBlobToBitmap(blob: Blob): Promise<ImageBitmap | null> {
  const Ctor = getImageDecoderCtor();
  if (!Ctor || !blob || blob.size === 0) return null;
  let decoder: ImageDecoderLike | null = null;
  let frame: VideoFrame | null = null;
  let bm: ImageBitmap | null = null;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length === 0) return null;
    const type = sniffMime(blob, bytes);
    if (type !== "image/jpeg" && type !== "image/png") return null; // HEIC etc: ruta actual
    decoder = new Ctor({ data: bytes, type });
    await decoder.tracks.ready;
    const { image } = await decoder.decode({ frameIndex: 0 });
    frame = image;
    if (frame.codedWidth <= 0 || frame.codedHeight <= 0) return null;
    bm = await createImageBitmap(frame);
    if (bm.width <= 0 || bm.height <= 0) {
      bm.close();
      return null;
    }
    // EXIF: ImageDecoder no la aplica — la aplicamos nosotros (equivalencia
    // exacta con <img>). PNG no lleva orientación en la práctica.
    const orientation = type === "image/png" ? 1 : readExifOrientation(bytes);
    if (orientation > 1) {
      const oriented = await applyExifOrientation(bm, orientation);
      bm = oriented;
    }
    return bm;
  } catch {
    try {
      bm?.close();
    } catch {
      /* ya cerrado */
    }
    return null;
  } finally {
    try {
      frame?.close();
    } catch {
      /* ya cerrado */
    }
    try {
      decoder?.close();
    } catch {
      /* ya cerrado */
    }
  }
}

/** data URL → Blob → ImageDecoder → ImageBitmap (null = usa tu ruta actual). */
export async function decodeDataUrlToBitmap(dataUrl: string): Promise<ImageBitmap | null> {
  try {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return decodeBlobToBitmap(blob);
  } catch {
    return null;
  }
}

// ─── §6 — supersampling en UN paso al export estándar ───────────────────────

export interface SupersampleOutcome {
  /** JPEG 0.92 con lado mayor == cap (o el blob original si ya era ≤ cap). */
  blob: Blob;
  srcLong: number;
  outLong: number;
  via: "webcodecs" | "createImageBitmap" | "passthrough";
}

function bitmapToJpegBlob(bm: ImageBitmap, quality = 0.92): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bm.width;
      canvas.height = bm.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bm, 0, 0);
      canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * PLAN B §6 — Captura hi-res: si el blob excede `cap` (4032), baja por
 * supersampling en UN SOLO paso con filtro de calidad (createImageBitmap
 * resizeQuality 'high' — prohibido el escalado en pasos del 50 %). El
 * resultado alimenta el pipeline ESTÁNDAR (export 4032 q0.95 intacto).
 *
 * Rutas (todas sin <img>):
 *  A) B2: ImageDecoder (orientación 1) → bitmap → UN resize de calidad.
 *  B) createImageBitmap(blob, {imageOrientation:'from-image'}) → bitmap →
 *     UN resize de calidad (aplica EXIF el propio navegador).
 *  C) blob ya ≤ cap → passthrough INTACTO (jamás se procesa por debajo de
 *     4032 lo que no lo necesita).
 *
 * Devuelve null ante cualquier fallo → el llamador usa clampBlobToSafeCap
 * (la capa 2 clásica de sensor-profiler queda como red de seguridad).
 */
export async function supersampleBlobToStandardCap(
  blob: Blob,
  cap: number
): Promise<SupersampleOutcome | null> {
  const t0 = performance.now();
  try {
    if (!blob || blob.size === 0 || !(cap > 0)) return null;

    const finish = async (
      srcBm: ImageBitmap,
      via: SupersampleOutcome["via"]
    ): Promise<SupersampleOutcome | null> => {
      const srcLong = Math.max(srcBm.width, srcBm.height);
      if (srcLong <= cap) {
        // Sensor que mintió su resolución (o photoSettings ignorado con foto
        // ya ≤ 4032): nada que bajar — el blob original pasa INTACTO.
        try {
          srcBm.close();
        } catch {
          /* ya cerrado */
        }
        setHiResTelemetry({
          srcLong,
          outLong: srcLong,
          via: "passthrough",
          ms: Math.round(performance.now() - t0),
          at: Date.now(),
        });
        return { blob, srcLong, outLong: srcLong, via: "passthrough" };
      }
      // §6 — UN paso, filtro de calidad, aspecto conservado.
      const scale = cap / srcLong;
      const rw = Math.max(1, Math.round(srcBm.width * scale));
      const rh = Math.max(1, Math.round(srcBm.height * scale));
      const small = await createImageBitmap(srcBm, {
        resizeWidth: rw,
        resizeHeight: rh,
        resizeQuality: "high",
      });
      try {
        srcBm.close();
      } catch {
        /* ya cerrado */
      }
      const out = await bitmapToJpegBlob(small);
      small.close();
      if (!out) return null;
      const outLong = Math.max(rw, rh);
      setHiResTelemetry({
        srcLong,
        outLong,
        via,
        ms: Math.round(performance.now() - t0),
        bytes: out.size,
        at: Date.now(),
      });
      return { blob: out, srcLong, outLong, via };
    };

    // Ruta A (B2) — solo orientación-safe si el EXIF es 1 (la transform
    // EXIF a resolución completa derrocharía la memoria que ahorra la ruta).
    const Ctor = getImageDecoderCtor();
    if (Ctor) {
      try {
        const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
        const isPng = head[0] === 0x89 && head[1] === 0x50;
        if (isPng || readExifOrientation(head) === 1) {
          const bm = await decodeBlobToBitmap(blob);
          if (bm) {
            const r = await finish(bm, "webcodecs");
            if (r) return r;
          }
        }
      } catch {
        /* ruta B */
      }
    }

    // Ruta B — decode+EXIF del navegador, luego UN resize de calidad.
    try {
      let bm0: ImageBitmap | null = null;
      try {
        bm0 = await createImageBitmap(blob, { imageOrientation: "from-image" });
      } catch {
        bm0 = await createImageBitmap(blob);
      }
      if (bm0) {
        const r = await finish(bm0, "createImageBitmap");
        if (r) return r;
      }
    } catch {
      /* null abajo */
    }
    return null;
  } catch {
    return null;
  }
}

// ─── QA local (patrón __sensorTools) ────────────────────────────────────────

declare global {
  interface Window {
    __techTools?: Record<string, unknown>;
  }
}

if (typeof window !== "undefined") {
  try {
    const w = window as unknown as { __techTools?: Record<string, unknown> };
    w.__techTools = {
      ...(w.__techTools ?? {}),
      decodeBlobToBitmap,
      readExifOrientation,
      /**
       * Autotest EXIF: construye un JPEG 64×32 (mitad izq roja / der azul),
       * le INYECTA un APP1 orientation=6 y verifica que la decodificación
       * B2 lo entrega rotado 90° CW (32×64, arriba roja / abajo azul).
       */
      exifSelfTest: async (): Promise<Record<string, unknown>> => {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 32;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = "#0000ff";
        ctx.fillRect(32, 0, 32, 32);
        const plain = await new Promise<Blob | null>((res) =>
          c.toBlob((b) => res(b), "image/jpeg", 0.95)
        );
        if (!plain) return { ok: false, error: "sin jpeg base" };
        const src = new Uint8Array(await plain.arrayBuffer());
        // APP1 Exif con orientation=6 (little-endian, 1 entrada IFD0).
        const app1 = new Uint8Array([
          0xff, 0xe1, 0x00, 0x1c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 "Exif\0\0"
          0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // TIFF II*, IFD en 8
          0x01, 0x00, // 1 entrada
          0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // 0x0112 SHORT 6
          0x00, 0x00, 0x00, 0x00, // siguiente IFD = 0
        ]);
        const tagged = new Uint8Array(src.length + app1.length);
        tagged.set([src[0]!, src[1]!], 0); // SOI
        tagged.set(app1, 2); // APP1 justo tras SOI
        tagged.set(src.subarray(2), 2 + app1.length);
        const taggedBlob = new Blob([tagged], { type: "image/jpeg" });
        const tag = readExifOrientation(tagged);
        const bm = await decodeBlobToBitmap(taggedBlob);
        if (!bm) {
          return { ok: false, error: "decodeBlobToBitmap devolvió null", tag };
        }
        const swapped = bm.width === 32 && bm.height === 64;
        const dims = `${bm.width}×${bm.height}`;
        const probe = document.createElement("canvas");
        probe.width = bm.width;
        probe.height = bm.height;
        probe.getContext("2d")!.drawImage(bm, 0, 0);
        const d = probe.getContext("2d")!.getImageData(0, 0, bm.width, bm.height).data;
        const at = (x: number, y: number) => {
          const i = (y * bm.width + x) * 4;
          return [d[i]!, d[i + 1]!, d[i + 2]!] as const;
        };
        const top = at(2, 2);
        const bottom = at(2, 61);
        const topRed = top[0] > 150 && top[2] < 100;
        const bottomBlue = bottom[2] > 150 && bottom[0] < 100;
        bm.close();
        return {
          ok: tag === 6 && swapped && topRed && bottomBlue,
          tag,
          dims,
          swapped,
          topRed,
          bottomBlue,
          imageDecoder: webcodecsDecodeAvailable(),
        };
      },
      /**
       * Autotest §6: JPEG sintético 5000×3750 → supersample UN paso a 4032.
       * Verifica dimensiones, vía usada y tiempos (sin sensor físico).
       */
      supersampleTest: async (): Promise<Record<string, unknown>> => {
        const c = document.createElement("canvas");
        c.width = 5000;
        c.height = 3750;
        const ctx = c.getContext("2d")!;
        const g = ctx.createLinearGradient(0, 0, 5000, 3750);
        g.addColorStop(0, "#f7f4ec");
        g.addColorStop(1, "#c9c4b8");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 5000, 3750);
        ctx.fillStyle = "#1c1c1e";
        for (let i = 0; i < 24; i++) {
          ctx.fillRect(300, 300 + i * 130, 2400 + (i % 5) * 260, 52);
        }
        const blob = await new Promise<Blob | null>((res) =>
          c.toBlob((b) => res(b), "image/jpeg", 0.92)
        );
        if (!blob) return { ok: false, error: "sin jpeg base" };
        const out = await supersampleBlobToStandardCap(blob, 4032);
        if (!out) return { ok: false, error: "supersample devolvió null" };
        const bm = await createImageBitmap(out.blob);
        const dims = `${bm.width}×${bm.height}`;
        const w = bm.width;
        bm.close();
        return {
          ok: out.outLong === 4032 && w === 4032,
          via: out.via,
          dims,
          outLong: out.outLong,
          srcLong: out.srcLong,
          srcBytes: blob.size,
          outBytes: out.blob.size,
        };
      },
    };
  } catch {
    /* SSR */
  }
}
