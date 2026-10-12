/**
 * PLAN B (B3) — Filtros WebGPU (WGSL): unsharp mask + realce «Texto claro».
 *
 * RUTA GPU del enhance del producto: puerto EXACTO de enhanceToRgba("text")
 * (image-modes.ts — el mismo contrato matemático del DetectionWorker):
 *
 *   gray   = luma entera (R·77+G·150+B·29)>>8
 *   shadow = estimateShadowModel(gray)      — downscale ≤800px nearest +
 *            close morfológico (kernel 25, separable max/min) + media → gains
 *   grayS  = gray × gains (muestreo BILINEAL de gains — F-TEXT-SMOOTH)
 *   wp     = whitePointStretchPct(0.95)    — percentil vía HISTOGRAMA GPU
 *   tgt    = LUT sigmoidal (textTargetLumaLut, construida en CPU con la
 *            MISMA función de image-modes) → afilado edge-aware (grad 25,
 *            amount 0.75, márgenes 1 px) → rebuildRgbaWithChroma (croma
 *            preservado, constantes 253/45/200/1.5)
 *
 * Todo el píxel-por-píxel corre en compute shaders; las dos reducciones
 * (media del mapa + histograma de grayS) usan atómicos u32 y UNA lectura
 * GPU→CPU de 1 KB. Los buffers viven en memoria GPU: el heap JS apenas crece
 * (esa es la hipótesis del plan — procesar grande sin el muro del canvas 2D).
 *
 * Equivalencia visual: las diferencias posibles contra WASM son de
 * redondeo (±1 en f32 vs f64) — sin halos ni banding por construcción
 * (las funciones son continuas por píxel). Ver `compareTextRoutes()` para
 * la comparación cuantitativa pixel a pixel contra la ruta CPU exacta.
 *
 * COBERTURA: modo «text» (el filtro insignia del producto) + unsharp
 * (Original con toggle de nitidez). «bw» NO se portó a GPU: Bradley-Roth
 * necesita una imagen integral y el despeckle es flood-fill serial — la
 * ruta WASM/worker queda INTACTA para bw y para cualquier fallo de GPU
 * (fallback POR LLAMADA, nunca global).
 */

import {
  gaussianKernel1D,
  ILLUM_KERNEL,
  ILLUM_MAP_LONG_SIDE,
  enhanceToRgba,
  textTargetLumaLut,
  TEXT_CLARO_WHITE_PCT,
  UNSHARP_AMOUNT,
  UNSHARP_KERNEL,
  UNSHARP_RADIUS,
} from "./image-modes";
import { peekSharedGpuAdapter, qaEmptyCapsForced } from "./tech-capabilities";
import { getScannerWorker, type EnhanceMode } from "./detector-client";

// ─── Fachada de tipos WebGPU (estructural — cero deps npm, regla 9) ─────────

interface GpuBufferLike {
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  readonly size: number;
}
interface GpuTextureLike {
  destroy(): void;
  createView(descriptor?: Record<string, unknown>): unknown;
}
interface GpuComputePassLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, group: unknown): void;
  dispatchWorkgroups(x: number, y: number, z?: number): void;
  end(): void;
}
interface GpuRenderPassLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, group: unknown): void;
  draw(vertexCount: number): void;
  end(): void;
}
interface GpuEncoderLike {
  beginComputePass(): GpuComputePassLike;
  beginRenderPass(descriptor: Record<string, unknown>): GpuRenderPassLike;
  finish(): unknown;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number
  ): void;
  copyTextureToBuffer(
    source: { texture: GpuTextureLike },
    destination: { buffer: GpuBufferLike; bytesPerRow: number; rowsPerImage: number },
    size: number[]
  ): void;
}
interface GpuQueueLike {
  submit(commands: unknown): void;
  writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView | ArrayBuffer): void;
  copyExternalImageToTexture(
    source: { source: unknown },
    destination: { texture: GpuTextureLike },
    size: number[]
  ): void;
  onSubmittedWorkDone(): Promise<unknown>;
}
interface GpuDeviceLike {
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: {
    layout: unknown;
    compute: { module: unknown; entryPoint: string };
  }): unknown;
  createRenderPipeline(descriptor: Record<string, unknown>): unknown;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createTexture(descriptor: Record<string, unknown>): GpuTextureLike;
  createBindGroup(descriptor: Record<string, unknown>): unknown;
  createSampler(descriptor: Record<string, unknown>): unknown;
  createCommandEncoder(): GpuEncoderLike;
  readonly queue: GpuQueueLike;
  destroy(): void;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike | null>;
}
/** GPUBufferUsage (constantes estables de la spec). */
const BUF = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
};
/** GPUTextureUsage. */
const TEX = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};
/** GPUMapMode.READ. */
const MAP_READ = 0x0001;

// ─── Contexto GPU de sesión (una sola solicitud de adapter) ─────────────────

interface GpuContext {
  device: GpuDeviceLike;
  format: string;
}

let gpuContext: GpuContext | null = null;
let gpuContextFailed = false;

/** Último error de la ruta GPU (telemetría QA — la ruta NUNCA lanza). */
let lastGpuError: string | null = null;

function noteGpuError(where: string, err: unknown): void {
  try {
    lastGpuError = `${where}: ${err instanceof Error ? err.message : String(err)}`;
  } catch {
    lastGpuError = `${where}: ?`;
  }
}

async function getGpuContext(): Promise<GpuContext | null> {
  if (gpuContext) return gpuContext;
  if (gpuContextFailed) return null;
  // B5 — flag QA de caps vacías: la ruta GPU queda APAGADA (app = main).
  if (qaEmptyCapsForced()) {
    gpuContextFailed = true;
    return null;
  }
  try {
    if (typeof navigator === "undefined" || typeof window === "undefined") return null;
    const gpu = (
      navigator as unknown as {
        gpu?: { requestAdapter(): Promise<unknown>; getPreferredCanvasFormat?(): string } | undefined;
      }
    ).gpu;
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      gpuContextFailed = true;
      return null;
    }
    // Reusa el adapter que B1 ya pidió (una sirena por sesión).
    let adapter = peekSharedGpuAdapter();
    if (adapter === undefined) {
      adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
      ]);
    }
    if (!adapter) {
      gpuContextFailed = true;
      return null;
    }
    const device = await (adapter as GpuAdapterLike).requestDevice();
    if (!device) {
      gpuContextFailed = true;
      return null;
    }
    const format =
      typeof gpu.getPreferredCanvasFormat === "function"
        ? gpu.getPreferredCanvasFormat()
        : "rgba8unorm";
    gpuContext = { device, format };
    return gpuContext;
  } catch {
    gpuContextFailed = true;
    return null;
  }
}

/** Invalida el contexto (QA / pérdida de device). */
export function resetGpuContext(): void {
  try {
    gpuContext?.device.destroy();
  } catch {
    /* ya muerto */
  }
  gpuContext = null;
  gpuContextFailed = false;
}

// ─── WGSL ───────────────────────────────────────────────────────────────────

/** Luma entera EXACTA de rgbaToGray ((R·77+G·150+B·29)>>8). */
const WGSL_LUMA = /* wgsl */ `
fn luma8(px: vec4<f32>) -> u32 {
  let r = u32(round(px.r * 255.0));
  let g = u32(round(px.g * 255.0));
  let b = u32(round(px.b * 255.0));
  return min(255u, (r * 77u + g * 150u + b * 29u) >> 8u);
}
`;

/** 1) rgba → gray (u32 0..255 por píxel). */
const WGSL_GRAY = /* wgsl */ `
${WGSL_LUMA}
struct ImgDims { w: u32, h: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> gray: array<u32>;
@group(0) @binding(2) var<uniform> dims: ImgDims;

@compute @workgroup_size(16, 16)
fn csGray(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dims.w || gid.y >= dims.h) { return; }
  let px = textureLoad(srcTex, vec2<i32>(gid.xy), 0);
  gray[gid.y * dims.w + gid.x] = luma8(px);
}
`;

/** 2) downscale nearest al mapa de iluminación (sampleDownscale verbatim). */
const WGSL_DOWN = /* wgsl */ `
struct DownDims { w: u32, h: u32, mw: u32, mh: u32 };
@group(0) @binding(0) var<storage, read> gray: array<u32>;
@group(0) @binding(1) var<storage, read_write> mapOut: array<f32>;
@group(0) @binding(2) var<uniform> dd: DownDims;

@compute @workgroup_size(16, 16)
fn csDown(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= dd.mw || gid.y >= dd.mh) { return; }
  let x = min(dd.w - 1u, u32(floor((f32(gid.x) + 0.5) * f32(dd.w) / f32(dd.mw))));
  let y = min(dd.h - 1u, u32(floor((f32(gid.y) + 0.5) * f32(dd.h) / f32(dd.mh))));
  mapOut[gid.y * dd.mw + gid.x] = f32(gray[y * dd.w + x]);
}
`;

/** 3) close morfológico separable (max/max/min/min; ventana centrada y
 *     acotada en bordes — equivalente al deque monótono de morphClose). */
const WGSL_CLOSE = /* wgsl */ `
struct CloseParams { mw: u32, mh: u32, half: u32, axis_op: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> cp: CloseParams;

@compute @workgroup_size(16, 16)
fn csClose(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= cp.mw || gid.y >= cp.mh) { return; }
  let x = gid.x;
  let y = gid.y;
  var acc = src[y * cp.mw + x];
  let axis = cp.axis_op >> 1u;
  let op = cp.axis_op & 1u;
  let t = i32(cp.half);
  if (axis == 0u) {
    for (var k = -t; k <= t; k = k + 1) {
      let xx = u32(clamp(i32(x) + k, 0, i32(cp.mw) - 1));
      let v = src[y * cp.mw + xx];
      acc = select(min(acc, v), max(acc, v), op == 0u);
    }
  } else {
    for (var k = -t; k <= t; k = k + 1) {
      let yy = u32(clamp(i32(y) + k, 0, i32(cp.mh) - 1));
      let v = src[yy * cp.mw + x];
      acc = select(min(acc, v), max(acc, v), op == 0u);
    }
  }
  dst[y * cp.mw + x] = acc;
}
`;

/** 4) suma del mapa (átomos u32: los valores son enteros 0..255 en f32). */
const WGSL_SUM = /* wgsl */ `
struct MapDims { mw: u32, mh: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> total: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> md: MapDims;

@compute @workgroup_size(16, 16)
fn csSum(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= md.mw || gid.y >= md.mh) { return; }
  let v = src[gid.y * md.mw + gid.x];
  atomicAdd(&total[0], u32(round(v)));
}
`;

/** 5) gains = media/mapa (estimateShadowModel verbatim). */
const WGSL_GAINS = /* wgsl */ `
struct GainParams { mw: u32, mh: u32, count: f32, mean: f32 };
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> gp: GainParams;

@compute @workgroup_size(16, 16)
fn csGains(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= gp.mw || gid.y >= gp.mh) { return; }
  let v = src[gid.y * gp.mw + gid.x];
  dst[gid.y * gp.mw + gid.x] = select(1.0, gp.mean / v, v > 0.0);
}
`;

/** Muestreo bilineal de gains + grayS cuantizado (compartido hist/text). */
const WGSL_GAIN_SAMPLE = /* wgsl */ `
struct HistDims { w: u32, h: u32, mw: u32, mh: u32 };
@group(0) @binding(0) var<storage, read> gray: array<u32>;
@group(0) @binding(1) var<storage, read> gains: array<f32>;
@group(0) @binding(2) var<uniform> hd: HistDims;

fn bilinearGain(x: u32, y: u32) -> f32 {
  // PUERTO EXACTO de correctedGrayWithModel (fx=(x·mw)/w, celdas clamped).
  let fx = (f32(x) * f32(hd.mw)) / f32(hd.w);
  let fy = (f32(y) * f32(hd.mh)) / f32(hd.h);
  let x0 = min(hd.mw - 1u, u32(floor(fx)));
  let y0 = min(hd.mh - 1u, u32(floor(fy)));
  let x1 = min(x0 + 1u, hd.mw - 1u);
  let y1 = min(y0 + 1u, hd.mh - 1u);
  let tx = clamp(fx - floor(fx), 0.0, 1.0);
  let ty = clamp(fy - floor(fy), 0.0, 1.0);
  let g00 = gains[y0 * hd.mw + x0];
  let g01 = gains[y0 * hd.mw + x1];
  let g10 = gains[y1 * hd.mw + x0];
  let g11 = gains[y1 * hd.mw + x1];
  let top = g00 + (g01 - g00) * tx;
  let bottom = g10 + (g11 - g10) * tx;
  return top + (bottom - top) * ty;
}

fn quantGrayS(x: u32, y: u32) -> u32 {
  let g = f32(gray[y * hd.w + x]) * bilinearGain(x, y);
  return u32(clamp(round(g), 0.0, 255.0));
}
`;

/** 6) histograma de grayS (percentil 0.95 del white point stretch). */
const WGSL_HIST = /* wgsl */ `
${WGSL_GAIN_SAMPLE}
@group(0) @binding(3) var<storage, read_write> hist: array<atomic<u32>>;

@compute @workgroup_size(16, 16)
fn csHist(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= hd.w || gid.y >= hd.h) { return; }
  let q = quantGrayS(gid.x, gid.y);
  atomicAdd(&hist[q], 1u);
}
`;

/** 7) FINAL text: LUT → afilado edge-aware → rebuild croma → rgba8. */
const WGSL_TEXT = /* wgsl */ `
${WGSL_GAIN_SAMPLE}
@group(0) @binding(3) var<storage, read> lut: array<u32>;
@group(0) @binding(4) var srcTex: texture_2d<f32>;
@group(0) @binding(5) var outTex: texture_storage_2d<rgba8unorm, write>;

fn targetOf(x: u32, y: u32) -> u32 {
  return lut[quantGrayS(x, y)];
}

@compute @workgroup_size(16, 16)
fn csText(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= hd.w || gid.y >= hd.h) { return; }
  let x = gid.x;
  let y = gid.y;
  let c = targetOf(x, y);
  var tgt = c;
  // edgeAwareSharpenGray — solo interior (márgenes de 1 px sin procesar).
  // TEXT_EDGE_GRADIENT 25 · TEXT_EDGE_AMOUNT 0.75 · luma < 240.
  if (x > 0u && y > 0u && x < hd.w - 1u && y < hd.h - 1u) {
    let l = targetOf(x - 1u, y);
    let r = targetOf(x + 1u, y);
    let u = targetOf(x, y - 1u);
    let d = targetOf(x, y + 1u);
    let grad = abs(f32(r) - f32(l)) + abs(f32(d) - f32(u));
    if (grad > 25.0 && f32(c) < 240.0) {
      let lap = (f32(l) + f32(r) + f32(u) + f32(d)) * 0.25 - f32(c);
      tgt = u32(clamp(round(f32(c) - lap * 0.75), 0.0, 255.0));
    }
  }
  // rebuildRgbaWithChroma — constantes congeladas de image-modes:
  // WHITE_TARGET 253 · NEUTRAL_INK 45 · CHROMA_FADE_START 200 · MAX_GAIN 1.5.
  let px = textureLoad(srcTex, vec2<i32>(gid.xy), 0);
  let srcL = f32(gray[y * hd.w + x]);
  var outPx: vec4<f32>;
  if (tgt >= 253u) {
    outPx = vec4<f32>(1.0, 1.0, 1.0, 1.0);
  } else {
    let t = f32(tgt);
    let scale = select(1.0, t / srcL, srcL > 5.0);
    var r = min(255.0, round(px.r * 255.0 * scale));
    var g = min(255.0, round(px.g * 255.0 * scale));
    var b = min(255.0, round(px.b * 255.0 * scale));
    if (t > 200.0) {
      let keep = max(0.0, (253.0 - t) / 53.0);
      r = round(t + (r - t) * keep);
      g = round(t + (g - t) * keep);
      b = round(t + (b - t) * keep);
    }
    if (scale > 1.5) {
      let dKeep = 1.5 / scale;
      r = round(t + (r - t) * dKeep);
      g = round(t + (g - t) * dKeep);
      b = round(t + (b - t) * dKeep);
    }
    if (tgt < 45u) {
      let blend = t / 45.0;
      r = round(r * blend + t * (1.0 - blend));
      g = round(g * blend + t * (1.0 - blend));
      b = round(b * blend + t * (1.0 - blend));
    }
    outPx = vec4<f32>(r / 255.0, g / 255.0, b / 255.0, 1.0);
  }
  textureStore(outTex, vec2<i32>(gid.xy), outPx);
}
`;

/** Unsharp separable — helpers compartidos (pesos exactos desde TS). */
const WGSL_UNSHARP_COMMON = /* wgsl */ `
fn packRgb(r: u32, g: u32, b: u32) -> u32 {
  return min(r, 255u) | (min(g, 255u) << 8u) | (min(b, 255u) << 16u);
}
`;

/** 8) unsharp — pase H (borde acotado, como blurChannel). */
const WGSL_UNSHARP_H = /* wgsl */ `
${WGSL_UNSHARP_COMMON}
struct UnsharpDims { w: u32, h: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> blurH: array<u32>;
@group(0) @binding(2) var<uniform> ud: UnsharpDims;
@group(0) @binding(3) var<storage, read> kern: array<f32>;

@compute @workgroup_size(16, 16)
fn csBlurH(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= ud.w || gid.y >= ud.h) { return; }
  var acc = vec3<f32>(0.0, 0.0, 0.0);
  for (var k = -3; k <= 3; k = k + 1) {
    let xx = u32(clamp(i32(gid.x) + k, 0, i32(ud.w) - 1));
    // OJO WGSL: el constructor vec2<i32> exige AMBOS args i32 (mixto = error
    // de compilación → pipeline inválido silencioso).
    let px = textureLoad(srcTex, vec2<i32>(i32(xx), i32(gid.y)), 0);
    let wgt = kern[k + 3];
    acc = acc + vec3<f32>(px.r, px.g, px.b) * 255.0 * wgt;
  }
  blurH[gid.y * ud.w + gid.x] = packRgb(u32(round(acc.r)), u32(round(acc.g)), u32(round(acc.b)));
}
`;

/** 9) unsharp — pase V (sobre el RGB empaquetado del pase H). */
const WGSL_UNSHARP_V = /* wgsl */ `
${WGSL_UNSHARP_COMMON}
struct UnsharpDims2 { w: u32, h: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> blurH: array<u32>;
@group(0) @binding(1) var<storage, read_write> blurV: array<u32>;
@group(0) @binding(2) var<uniform> ud: UnsharpDims2;
@group(0) @binding(3) var<storage, read> kern: array<f32>;

@compute @workgroup_size(16, 16)
fn csBlurV(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= ud.w || gid.y >= ud.h) { return; }
  var acc = vec3<f32>(0.0, 0.0, 0.0);
  for (var k = -3; k <= 3; k = k + 1) {
    let yy = u32(clamp(i32(gid.y) + k, 0, i32(ud.h) - 1));
    let p = blurH[yy * ud.w + gid.x];
    acc = acc + vec3<f32>(f32(p & 0xffu), f32((p >> 8u) & 0xffu), f32((p >> 16u) & 0xffu)) * kern[k + 3];
  }
  blurV[gid.y * ud.w + gid.x] = packRgb(u32(round(acc.r)), u32(round(acc.g)), u32(round(acc.b)));
}
`;

/** 10) unsharp — combine: out = round(src·1.5 − blur·0.5) por canal. */const WGSL_UNSHARP_COMBINE = /* wgsl */ `
struct UnsharpCombine { w: u32, h: u32, k1: f32, amount: f32 };
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> blurV: array<u32>;
@group(0) @binding(2) var<uniform> uc: UnsharpCombine;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(16, 16)
fn csCombine(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= uc.w || gid.y >= uc.h) { return; }
  let p = blurV[gid.y * uc.w + gid.x];
  let px = textureLoad(srcTex, vec2<i32>(gid.xy), 0);
  let r = clamp(round(px.r * 255.0 * uc.k1 - f32(p & 0xffu) * uc.amount), 0.0, 255.0);
  let g = clamp(round(px.g * 255.0 * uc.k1 - f32((p >> 8u) & 0xffu) * uc.amount), 0.0, 255.0);
  let b = clamp(round(px.b * 255.0 * uc.k1 - f32((p >> 16u) & 0xffu) * uc.amount), 0.0, 255.0);
  textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(r / 255.0, g / 255.0, b / 255.0, 1.0));
}
`;


// ─── Helpers de orquestación GPU ─────────────────────────────────────────────

interface GpuRun {
  device: GpuDeviceLike;
  format: string;
  module(code: string): unknown;
  computePipe(code: string, entryPoint: string): unknown;
  bindGroup(pipeline: unknown, entries: Array<{ binding: number; resource: unknown }>): unknown;
  uniformU32(values: number[]): GpuBufferLike;
  uniformMixed(build: (u32: Uint32Array, f32: Float32Array) => void): GpuBufferLike;
  trash: Array<{ destroy(): void }>;
}

function beginRun(ctx: GpuContext): GpuRun {
  const { device } = ctx;
  const trash: Array<{ destroy(): void }> = [];
  const run: GpuRun = {
    device,
    format: ctx.format,
    module: (code) => device.createShaderModule({ code }),
    computePipe: (code, entryPoint) =>
      device.createComputePipeline({
        layout: "auto",
        compute: { module: device.createShaderModule({ code }), entryPoint },
      }),
    bindGroup: (pipeline, entries) =>
      device.createBindGroup({
        layout: (
          pipeline as unknown as { getBindGroupLayout(index: number): unknown }
        ).getBindGroupLayout(0),
        entries,
      }),
    uniformU32(values) {
      const buf = device.createBuffer({ size: 16, usage: BUF.UNIFORM | BUF.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Uint32Array(values));
      trash.push(buf);
      return buf;
    },
    uniformMixed(build) {
      const ab = new ArrayBuffer(16);
      build(new Uint32Array(ab), new Float32Array(ab));
      const buf = device.createBuffer({ size: 16, usage: BUF.UNIFORM | BUF.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Uint32Array(ab));
      trash.push(buf);
      return buf;
    },
    trash,
  };
  return run;
}

/**
 * SALIDA — Lee la textura rgba8unorm escrita por compute a un ImageData
 * (copyTextureToBuffer con alineación de 256 + unpack de filas). Evita el
 * render pass a canvas WebGPU por completo: universal (funciona igual con
 * hardware, SwiftShader y contextos sin swapchain), sin volteos Y y sin
 * depender de convertToBlob sobre contexto webgpu.
 */
async function readTextureToImageData(
  device: GpuDeviceLike,
  tex: GpuTextureLike,
  w: number,
  h: number
): Promise<ImageData | null> {
  const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
  const size = bytesPerRow * h;
  const buf = device.createBuffer({ size, usage: BUF.MAP_READ | BUF.COPY_DST });
  try {
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: tex },
      { buffer: buf, bytesPerRow, rowsPerImage: h },
      [w, h, 1]
    );
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(MAP_READ);
    const src = new Uint8Array(buf.getMappedRange());
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      img.data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    }
    buf.unmap();
    return img;
  } catch {
    return null;
  } finally {
    try {
      buf.destroy();
    } catch {
      /* ya destruido */
    }
  }
}

/** ImageData → PNG (canvas 2D — encode nativo del navegador). */
async function imageDataToPngBlob(img: ImageData): Promise<Blob | null> {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(img.width, img.height);
      (c.getContext("2d") as OffscreenCanvasRenderingContext2D | null)?.putImageData(img, 0, 0);
      return await (c as unknown as {
        convertToBlob(o: { type: string }): Promise<Blob>;
      }).convertToBlob({ type: "image/png" });
    }
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")?.putImageData(img, 0, 0);
    return await new Promise<Blob | null>((resolve) => {
      try {
        c.toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/** Percentil del white point stretch (puerto EXACTO de whitePointStretchPct):
 *  pivot = primer v cuya acumulación ≥ ceil(n·p); scale = 255/pivot. */
function histToScale(hist: Uint32Array, n: number, p: number): number {
  const target = Math.ceil(n * p);
  let acc = 0;
  let pivot = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= target) {
      pivot = v;
      break;
    }
  }
  if (pivot <= 0) return 1;
  return 255 / pivot;
}

/** LUT combinada grayS→targetLuma (white point stretch ∘ LUT sigmoidal). */
function buildCombinedLut(scale: number): Uint32Array {
  const lut = textTargetLumaLut(); // constantes exactas de image-modes
  const out = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    let wp = Math.round(v * scale);
    if (wp > 255) wp = 255;
    if (wp < 0) wp = 0;
    out[v] = lut[wp]!;
  }
  return out;
}

function groups2(w: number, h: number): [number, number] {
  return [Math.ceil(w / 16), Math.ceil(h / 16)];
}

// ─── B3 — enhance «text» vía WebGPU ─────────────────────────────────────────

export interface GpuEnhanceOutcome {
  blob: Blob;
  mime: "image/png";
  w: number;
  h: number;
  elapsedMs: number;
}

/**
 * Realce «Texto claro» en GPU (puerto exacto de enhanceToRgba("text")).
 * Devuelve null ante CUALQUIER fallo (sin adapter, dims inválidas, error de
 * device…) o si el modo no es «text» → el llamador cae a su ruta actual
 * (worker WASM), que queda INTACTA.
 */
export async function enhanceViaWebGPU(
  source: HTMLCanvasElement | ImageBitmap | HTMLImageElement,
  mode: EnhanceMode,
  opts?: { maxLongSide?: number }
): Promise<GpuEnhanceOutcome | null> {
  if (mode !== "text") return null;
  const ctx = await getGpuContext();
  if (!ctx) return null;
  const t0 = performance.now();

  let src: HTMLCanvasElement | ImageBitmap | HTMLImageElement = source;
  let ownedBitmap: ImageBitmap | null = null;
  let out: GpuEnhanceOutcome | null = null;

  try {
    // maxLongSide: si la fuente excede el tope, UN paso de calidad (§6).
    const maxLong = opts?.maxLongSide ?? 4032;
    const sw = source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width;
    const sh = source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height;
    if (!(sw > 0) || !(sh > 0)) return null;
    if (Math.max(sw, sh) > maxLong) {
      const scale = maxLong / Math.max(sw, sh);
      ownedBitmap = await createImageBitmap(source, {
        resizeWidth: Math.max(1, Math.round(sw * scale)),
        resizeHeight: Math.max(1, Math.round(sh * scale)),
        resizeQuality: "high",
      });
      src = ownedBitmap;
    }
    const w = src instanceof HTMLImageElement ? src.naturalWidth || src.width : src.width;
    const h = src instanceof HTMLImageElement ? src.naturalHeight || src.height : src.height;
    if (!(w > 0) || !(h > 0)) {
      noteGpuError("dims", new Error(`dims inválidas ${w}×${h}`));
      return null;
    }

    const run = beginRun(ctx);
    const { device, trash } = run;
    try {
      // ── Recursos GPU ──
      const srcTex = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT,
      });
      trash.push(srcTex);
      const outTex = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING | TEX.COPY_SRC,
      });
      trash.push(outTex);
      const grayBuf = device.createBuffer({ size: w * h * 4, usage: BUF.STORAGE });
      trash.push(grayBuf);
      const mapScale = Math.min(1, ILLUM_MAP_LONG_SIDE / Math.max(w, h));
      const mw = Math.max(1, Math.round(w * mapScale));
      const mh = Math.max(1, Math.round(h * mapScale));
      const mapA = device.createBuffer({ size: mw * mh * 4, usage: BUF.STORAGE });
      const mapB = device.createBuffer({ size: mw * mh * 4, usage: BUF.STORAGE });
      const gainsBuf = device.createBuffer({ size: mw * mh * 4, usage: BUF.STORAGE });
      trash.push(mapA, mapB, gainsBuf);
      const sumBuf = device.createBuffer({
        size: 4,
        usage: BUF.STORAGE | BUF.COPY_SRC,
      });
      trash.push(sumBuf);
      const histBuf = device.createBuffer({
        size: 1024,
        usage: BUF.STORAGE | BUF.COPY_SRC,
      });
      trash.push(histBuf);
      const staging = device.createBuffer({
        size: 1028,
        usage: BUF.MAP_READ | BUF.COPY_DST,
      });
      trash.push(staging);
      const lutBuf = device.createBuffer({
        size: 1024,
        usage: BUF.STORAGE | BUF.COPY_DST,
      });
      trash.push(lutBuf);

      device.queue.copyExternalImageToTexture({ source: src }, { texture: srcTex }, [w, h]);

      // ── Pipelines + uniforms ──
      const pipeGray = run.computePipe(WGSL_GRAY, "csGray");
      const pipeDown = run.computePipe(WGSL_DOWN, "csDown");
      const pipeClose = run.computePipe(WGSL_CLOSE, "csClose");
      const pipeSum = run.computePipe(WGSL_SUM, "csSum");
      const pipeGains = run.computePipe(WGSL_GAINS, "csGains");
      const pipeHist = run.computePipe(WGSL_HIST, "csHist");
      const pipeText = run.computePipe(WGSL_TEXT, "csText");

      const uGray = run.uniformU32([w, h, 0, 0]);
      const uDown = run.uniformU32([w, h, mw, mh]);
      const uMap = run.uniformU32([mw, mh, 0, 0]);
      const uGain = run.uniformMixed((u32, f32) => {
        u32[0] = mw;
        u32[1] = mh;
        f32[2] = mw * mh;
        f32[3] = 255; // media provisional — se reescribe tras el readback
      });
      const uHist = run.uniformU32([w, h, mw, mh]);
      const half = ILLUM_KERNEL >> 1;
      // axis_op: 0=H-max · 1=H-min · 2=V-max · 3=V-min (axis*2+op).
      const uCloseHM = run.uniformU32([mw, mh, half, 0]);
      const uCloseVM = run.uniformU32([mw, mh, half, 2]);
      const uCloseHm = run.uniformU32([mw, mh, half, 1]);
      const uCloseVm = run.uniformU32([mw, mh, half, 3]);

      const bgGray = run.bindGroup(pipeGray, [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: { buffer: grayBuf } },
        { binding: 2, resource: { buffer: uGray } },
      ]);
      const bgDown = run.bindGroup(pipeDown, [
        { binding: 0, resource: { buffer: grayBuf } },
        { binding: 1, resource: { buffer: mapA } },
        { binding: 2, resource: { buffer: uDown } },
      ]);
      const closeBg = (u: GpuBufferLike, srcB: GpuBufferLike, dstB: GpuBufferLike) =>
        run.bindGroup(pipeClose, [
          { binding: 0, resource: { buffer: srcB } },
          { binding: 1, resource: { buffer: dstB } },
          { binding: 2, resource: { buffer: u } },
        ]);
      const bgCloseHM = closeBg(uCloseHM, mapA, mapB);
      const bgCloseVM = closeBg(uCloseVM, mapB, mapA);
      const bgCloseHm = closeBg(uCloseHm, mapA, mapB);
      const bgCloseVm = closeBg(uCloseVm, mapB, mapA);
      const bgSum = run.bindGroup(pipeSum, [
        { binding: 0, resource: { buffer: mapA } },
        { binding: 1, resource: { buffer: sumBuf } },
        { binding: 2, resource: { buffer: uMap } },
      ]);
      const bgGains = run.bindGroup(pipeGains, [
        { binding: 0, resource: { buffer: mapA } },
        { binding: 1, resource: { buffer: gainsBuf } },
        { binding: 2, resource: { buffer: uGain } },
      ]);
      const bgHist = run.bindGroup(pipeHist, [
        { binding: 0, resource: { buffer: grayBuf } },
        { binding: 1, resource: { buffer: gainsBuf } },
        { binding: 2, resource: { buffer: uHist } },
        { binding: 3, resource: { buffer: histBuf } },
      ]);
      const bgText = run.bindGroup(pipeText, [
        { binding: 0, resource: { buffer: grayBuf } },
        { binding: 1, resource: { buffer: gainsBuf } },
        { binding: 2, resource: { buffer: uHist } },
        { binding: 3, resource: { buffer: lutBuf } },
        { binding: 4, resource: srcTex.createView() },
        { binding: 5, resource: outTex.createView() },
      ]);

      const [gx, gy] = groups2(w, h);
      const [mx, my] = groups2(mw, mh);
      const dispatch = (
        p: GpuComputePassLike,
        pipeline: unknown,
        group: unknown,
        x: number,
        y: number
      ) => {
        p.setPipeline(pipeline);
        p.setBindGroup(0, group);
        p.dispatchWorkgroups(x, y);
      };

      // ── Submit 1: gray → down → close×4 → sum (+ copia a staging) ──
      const enc1 = device.createCommandEncoder();
      let cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeGray, bgGray, gx, gy);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeDown, bgDown, mx, my);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeClose, bgCloseHM, mx, my);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeClose, bgCloseVM, mx, my);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeClose, bgCloseHm, mx, my);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeClose, bgCloseVm, mx, my);
      cp1.end();
      cp1 = enc1.beginComputePass();
      dispatch(cp1, pipeSum, bgSum, mx, my);
      cp1.end();
      enc1.copyBufferToBuffer(sumBuf, 0, staging, 0, 4);
      device.queue.submit([enc1.finish()]);

      // ── Readback 1: media del mapa cerrado ──
      await staging.mapAsync(MAP_READ);
      const sum = new Uint32Array(staging.getMappedRange().slice(0))[0] ?? 0;
      staging.unmap();
      const mapCount = mw * mh;
      const mean = mapCount > 0 ? sum / mapCount : 255;
      const uGain2 = run.uniformMixed((u32, f32) => {
        u32[0] = mw;
        u32[1] = mh;
        f32[2] = mapCount;
        f32[3] = Number.isFinite(mean) && mean > 0 ? mean : 255;
      });
      const bgGains2 = run.bindGroup(pipeGains, [
        { binding: 0, resource: { buffer: mapA } },
        { binding: 1, resource: { buffer: gainsBuf } },
        { binding: 2, resource: { buffer: uGain2 } },
      ]);

      // ── Submit 2: gains → hist (+ copia a staging) ──
      const enc2 = device.createCommandEncoder();
      let cp2 = enc2.beginComputePass();
      dispatch(cp2, pipeGains, bgGains2, mx, my);
      cp2.end();
      cp2 = enc2.beginComputePass();
      dispatch(cp2, pipeHist, bgHist, gx, gy);
      cp2.end();
      enc2.copyBufferToBuffer(histBuf, 0, staging, 4, 1024);
      device.queue.submit([enc2.finish()]);

      // ── Readback 2: histograma → pivot/scale → LUT combinada ──
      await staging.mapAsync(MAP_READ);
      const raw = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      const hist = raw.subarray(1, 257) as Uint32Array;
      const scale = histToScale(hist, w * h, TEXT_CLARO_WHITE_PCT);
      device.queue.writeBuffer(lutBuf, 0, buildCombinedLut(scale));

      // ── Submit 3: text final → outTex → readback a ImageData ──
      const enc3 = device.createCommandEncoder();
      const cp3 = enc3.beginComputePass();
      dispatch(cp3, pipeText, bgText, gx, gy);
      cp3.end();
      device.queue.submit([enc3.finish()]);
      await device.queue.onSubmittedWorkDone();

      const img = await readTextureToImageData(device, outTex, w, h);
      if (!img) {
        noteGpuError("readback", new Error("copyTextureToBuffer falló"));
        return null;
      }
      // Red anti-fallo-silencioso: los shaders SIEMPRE escriben alpha=255
      // en rango — un alpha 0 generalizado = dispatch que no corrió
      // (pipeline inválido por driver) → fallback a la ruta actual.
      let anyAlpha = false;
      for (let i = 3; i < img.data.length; i += 64) {
        if (img.data[i] !== 0) {
          anyAlpha = true;
          break;
        }
      }
      if (!anyAlpha) {
        noteGpuError("empty-output", new Error("salida GPU nunca escrita"));
        return null;
      }
      const blob = await imageDataToPngBlob(img);
      if (!blob || blob.size === 0) {
        noteGpuError("encode", new Error("PNG vacío"));
        return null;
      }
      out = {
        blob,
        mime: "image/png",
        w,
        h,
        elapsedMs: Math.round(performance.now() - t0),
      };
      return out;
    } finally {
      // Higiene GPU: los recursos de ESTA corrida se sueltan ya.
      try {
        await ctx.device.queue.onSubmittedWorkDone();
      } catch {
        /* device perdido */
      }
      for (const t of trash) {
        try {
          t.destroy();
        } catch {
          /* ya destruido */
        }
      }
    }
  } catch (err) {
    noteGpuError("enhance", err);
    return null;
  } finally {
    try {
      ownedBitmap?.close();
    } catch {
      /* ya cerrado */
    }
  }
}

// ─── B3 — unsharp vía WebGPU (Original + toggle de nitidez) ─────────────────

/**
 * Unsharp mask EXACTO del producto (gauss k7 σ1.5 separable + addWeighted
 * 1.5/−0.5 — mismo contrato que applyUnsharpToCanvas) en GPU. Devuelve un
 * NUEVO HTMLCanvasElement con el resultado, o null ante cualquier fallo
 * (el llamador cae a applyUnsharpToCanvas, que queda intacto).
 */
export async function unsharpViaWebGPU(
  source: HTMLCanvasElement
): Promise<HTMLCanvasElement | null> {
  const ctx = await getGpuContext();
  if (!ctx) return null;
  const w = source.width;
  const h = source.height;
  if (!(w > 0) || !(h > 0)) return null;
  try {
    const run = beginRun(ctx);
    const { device, trash } = run;
    try {
      const srcTex = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT,
      });
      trash.push(srcTex);
      const outTex = device.createTexture({
        size: [w, h],
        format: "rgba8unorm",
        usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING | TEX.COPY_SRC,
      });
      trash.push(outTex);
      const blurH = device.createBuffer({ size: w * h * 4, usage: BUF.STORAGE });
      const blurV = device.createBuffer({ size: w * h * 4, usage: BUF.STORAGE });
      trash.push(blurH, blurV);
      // Pesos gaussianos EXACTOS del core (mismo kernel que el fallback JS).
      const kernArr = new Float32Array(8);
      const kern = gaussianKernel1D(UNSHARP_KERNEL, UNSHARP_RADIUS);
      for (let i = 0; i < 7; i++) kernArr[i] = kern[i]!;
      const kernBuf = device.createBuffer({ size: 32, usage: BUF.STORAGE | BUF.COPY_DST });
      trash.push(kernBuf);
      device.queue.writeBuffer(kernBuf, 0, kernArr);

      device.queue.copyExternalImageToTexture({ source }, { texture: srcTex }, [w, h]);

      const pipeH = run.computePipe(WGSL_UNSHARP_H, "csBlurH");
      const pipeV = run.computePipe(WGSL_UNSHARP_V, "csBlurV");
      const pipeC = run.computePipe(WGSL_UNSHARP_COMBINE, "csCombine");
      const uDims = run.uniformU32([w, h, 0, 0]);
      const uCombine = run.uniformMixed((u32, f32) => {
        u32[0] = w;
        u32[1] = h;
        f32[2] = 1 + UNSHARP_AMOUNT;
        f32[3] = UNSHARP_AMOUNT;
      });

      const bgH = run.bindGroup(pipeH, [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: { buffer: blurH } },
        { binding: 2, resource: { buffer: uDims } },
        { binding: 3, resource: { buffer: kernBuf } },
      ]);
      const bgV = run.bindGroup(pipeV, [
        { binding: 0, resource: { buffer: blurH } },
        { binding: 1, resource: { buffer: blurV } },
        { binding: 2, resource: { buffer: uDims } },
        { binding: 3, resource: { buffer: kernBuf } },
      ]);
      const bgC = run.bindGroup(pipeC, [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: { buffer: blurV } },
        { binding: 2, resource: { buffer: uCombine } },
        { binding: 3, resource: outTex.createView() },
      ]);

      const [gx, gy] = groups2(w, h);
      const enc = device.createCommandEncoder();
      let p = enc.beginComputePass();
      p.setPipeline(pipeH);
      p.setBindGroup(0, bgH);
      p.dispatchWorkgroups(gx, gy);
      p.end();
      p = enc.beginComputePass();
      p.setPipeline(pipeV);
      p.setBindGroup(0, bgV);
      p.dispatchWorkgroups(gx, gy);
      p.end();
      p = enc.beginComputePass();
      p.setPipeline(pipeC);
      p.setBindGroup(0, bgC);
      p.dispatchWorkgroups(gx, gy);
      p.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();

      // Readback → HTMLCanvasElement 2D (contrato del llamador:
      // applyUnsharpToCanvas devuelve el MISMO canvas mutado).
      const img = await readTextureToImageData(device, outTex, w, h);
      if (!img) {
        noteGpuError("readback-unsharp", new Error("copyTextureToBuffer falló"));
        return null;
      }
      let anyAlpha = false;
      for (let i = 3; i < img.data.length; i += 64) {
        if (img.data[i] !== 0) {
          anyAlpha = true;
          break;
        }
      }
      if (!anyAlpha) {
        noteGpuError("empty-output-unsharp", new Error("salida GPU nunca escrita"));
        return null;
      }
      const result = document.createElement("canvas");
      result.width = w;
      result.height = h;
      const rctx = result.getContext("2d");
      if (!rctx) return null;
      rctx.putImageData(img, 0, 0);
      return result;
    } finally {
      try {
        await ctx.device.queue.onSubmittedWorkDone();
      } catch {
        /* device perdido */
      }
      for (const t of trash) {
        try {
          t.destroy();
        } catch {
          /* ya destruido */
        }
      }
    }
  } catch (err) {
    noteGpuError("unsharp", err);
    return null;
  }
}

// ─── Documento sintético (benchmark / equivalencia) ──────────────────────────

/** Documento de prueba determinista: papel con sombra diagonal, «texto» en
 *  barras, sello de color y ruido de sensor (LCG). */
export function synthDocCanvas(longSide: number): HTMLCanvasElement {
  const w = Math.max(64, Math.round(longSide));
  const h = Math.max(48, Math.round((longSide * 3) / 4));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#f8f5ee");
  g.addColorStop(0.55, "#efe9dc");
  g.addColorStop(1, "#d9d2c3");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // «Texto»: barras de grosores variados (ejercita bordes + afilado).
  ctx.fillStyle = "#23252d";
  const rows = 26;
  const pad = Math.round(w * 0.08);
  const lineH = Math.round((h - 2 * pad) / rows);
  const barH = Math.max(1, Math.round(lineH * 0.34));
  for (let r = 0; r < rows; r++) {
    const y = pad + r * lineH;
    const seedBars = ((r * 2654435761) >>> 0) / 4294967296;
    const words = 2 + Math.floor(seedBars * 4);
    let x = pad;
    for (let b = 0; b < words && x < w - pad; b++) {
      const seedW = (((r * 31 + b * 97) * 2654435761) >>> 0) / 4294967296;
      const bw = Math.round((w - 2 * pad) * (0.12 + seedW * 0.3));
      ctx.fillRect(x, y, Math.min(bw, w - pad - x), barH);
      x += bw + Math.round(lineH * 0.5);
    }
  }
  // Sello (color — ejercita la preservación de croma).
  ctx.save();
  ctx.translate(w * 0.68, h * 0.78);
  ctx.rotate(-0.18);
  ctx.strokeStyle = "rgba(198,44,44,0.82)";
  ctx.lineWidth = Math.max(2, w / 320);
  const stampW = w * 0.24;
  const stampH = h * 0.09;
  ctx.strokeRect(0, 0, stampW, stampH);
  ctx.fillStyle = "rgba(198,44,44,0.88)";
  ctx.font = `bold ${Math.round(h * 0.035)}px sans-serif`;
  ctx.fillText("PAGADO", stampW * 0.14, stampH * 0.68);
  ctx.restore();
  // Ruido de sensor (determinista).
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  const dots = Math.round((w * h) / 42);
  for (let i = 0; i < dots; i++) {
    ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
  }
  return canvas;
}

// ─── Benchmark B3 (WebGPU vs WASM/worker vs CPU exacto) ─────────────────────

export interface BenchRow {
  longSide: number;
  gpuMs: number[] | null;
  wasmMs: number[] | null;
  cpuMs: number[] | null;
}

/** Benchmark del filtro «text» en las 3 rutas (warmup 1 + N corridas). */
export async function benchmarkEnhanceRoutes(
  longSides: number[] = [2048, 4032],
  runs = 3
): Promise<{ rows: BenchRow[]; webgpu: boolean; workerReady: boolean }> {
  const ctx = await getGpuContext();
  const client = getScannerWorker();
  const workerReady = client && !client.isDead ? await client.waitReady() : false;
  const rows: BenchRow[] = [];
  for (const L of longSides) {
    const canvas = synthDocCanvas(L);
    const row: BenchRow = { longSide: L, gpuMs: null, wasmMs: null, cpuMs: null };
    if (ctx) {
      // warmup (compila pipelines / sube buffers por primera vez)
      await enhanceViaWebGPU(canvas, "text", { maxLongSide: L });
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const r = await enhanceViaWebGPU(canvas, "text", { maxLongSide: L });
        if (!r) {
          times.length = 0;
          break;
        }
        times.push(Math.round(performance.now() - t0));
      }
      row.gpuMs = times.length ? times : null;
    }
    if (workerReady && client) {
      const warm = await createImageBitmap(canvas);
      await client.enhance(warm, "text", {});
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const bm = await createImageBitmap(canvas);
        const t0 = performance.now();
        const r = await client.enhance(bm, "text", {});
        const dt = Math.round(performance.now() - t0);
        if (!r) {
          times.length = 0;
          break;
        }
        times.push(dt);
      }
      row.wasmMs = times.length ? times : null;
    }
    {
      // CPU exacto (image-modes — la referencia de equivalencia).
      const w = canvas.width;
      const h = canvas.height;
      const c2 = document.createElement("canvas");
      c2.width = w;
      c2.height = h;
      const cctx = c2.getContext("2d", { willReadFrequently: true })!;
      cctx.drawImage(canvas, 0, 0);
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const img = cctx.getImageData(0, 0, w, h);
        const t0 = performance.now();
        const res = enhanceToRgba(img.data, w, h, "text");
        times.push(Math.round(performance.now() - t0));
        if (res.length !== w * h * 4) break; // sanity (nunca ocurre)
      }
      row.cpuMs = times;
    }
    rows.push(row);
  }
  try {
    console.table(
      rows.map((r) => ({
        longSide: r.longSide,
        "GPU ms (med)": r.gpuMs ? median(r.gpuMs) : "n/d",
        "WASM ms (med)": r.wasmMs ? median(r.wasmMs) : "n/d",
        "CPU ms (med)": r.cpuMs ? median(r.cpuMs) : "n/d",
      }))
    );
  } catch {
    /* sin consola */
  }
  return { rows, webgpu: !!ctx, workerReady };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

// ─── Equivalencia visual (B3): GPU vs CPU exacto vs worker ──────────────────

async function blobToRgba(blob: Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  try {
    const bm = await createImageBitmap(blob);
    const w = bm.width;
    const h = bm.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bm, 0, 0);
    bm.close();
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

function rgbaDiff(
  a: { data: Uint8ClampedArray; w: number; h: number },
  b: { data: Uint8ClampedArray; w: number; h: number }
): { meanAbs: number; maxAbs: number; pctGt2: number; pctGt8: number } | null {
  if (a.w !== b.w || a.h !== b.h) return null;
  let sum = 0;
  let max = 0;
  let gt2 = 0;
  let gt8 = 0;
  const px = a.w * a.h;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    let d = 0;
    for (let c = 0; c < 3; c++) {
      d += Math.abs(a.data[o + c]! - b.data[o + c]!);
    }
    sum += d;
    if (d > max) max = d;
    if (d > 2) gt2++;
    if (d > 8) gt8++;
  }
  return {
    meanAbs: +(sum / px).toFixed(3),
    maxAbs: max,
    pctGt2: +((gt2 / px) * 100).toFixed(3),
    pctGt8: +((gt8 / px) * 100).toFixed(3),
  };
}

/**
 * Compara la salida del filtro «text» en las rutas disponibles sobre el
 * MISMO documento sintético: GPU (WebGPU) vs CPU exacto (image-modes — la
 * matemática de referencia) vs worker WASM. Devuelve estadísticas de diff
 * pixel a pixel + un composite lado a lado (data URL) para inspección.
 */
export async function compareTextRoutes(
  longSide = 1024
): Promise<Record<string, unknown>> {
  const canvas = synthDocCanvas(longSide);
  const w = canvas.width;
  const h = canvas.height;
  const result: Record<string, unknown> = { longSide, w, h };

  // CPU exacto (referencia): image-modes «text» sobre el mismo lienzo.
  const cctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const tCpu = performance.now();
  const cpuOut = enhanceToRgba(cctx.getImageData(0, 0, w, h).data, w, h, "text");
  const cpuMs = Math.round(performance.now() - tCpu);
  const cpuCanvas = document.createElement("canvas");
  cpuCanvas.width = w;
  cpuCanvas.height = h;
  const cpuCtx = cpuCanvas.getContext("2d")!;
  const cpuImg = cpuCtx.createImageData(w, h);
  cpuImg.data.set(cpuOut);
  cpuCtx.putImageData(cpuImg, 0, 0);
  const cpuRgba = { data: cpuCtx.getImageData(0, 0, w, h).data, w, h };

  // GPU.
  const tGpu = performance.now();
  const gpu = await enhanceViaWebGPU(canvas, "text", { maxLongSide: longSide });
  const gpuMs = gpu ? Math.round(performance.now() - tGpu) : null;
  result.gpu = gpu ? { ms: gpu.elapsedMs, bytes: gpu.blob.size } : null;
  result.cpuMs = cpuMs;
  result.gpuMsWall = gpuMs;

  let sideBySide: string | null = null;
  let gpuRgba: { data: Uint8ClampedArray; w: number; h: number } | null = null;
  if (gpu) {
    gpuRgba = await blobToRgba(gpu.blob);
    if (gpuRgba) {
      result.diffGpuVsCpu = rgbaDiff(gpuRgba, cpuRgba);
    }
    // Composite 2-up para inspección visual (GPU | CPU).
    const comp = document.createElement("canvas");
    comp.width = w * 2 + 12;
    comp.height = h;
    const cc = comp.getContext("2d")!;
    cc.fillStyle = "#111";
    cc.fillRect(0, 0, comp.width, comp.height);
    const gpuBm = await createImageBitmap(gpu.blob);
    cc.drawImage(gpuBm, 0, 0);
    cc.drawImage(cpuCanvas, w + 12, 0);
    gpuBm.close();
    sideBySide = comp.toDataURL("image/jpeg", 0.9);
  }

  // Worker WASM (si está listo).
  const client = getScannerWorker();
  if (client && !client.isDead && (await client.waitReady())) {
    const bm = await createImageBitmap(canvas);
    const t0 = performance.now();
    const r = await client.enhance(bm, "text", {});
    result.workerMs = r ? Math.round(performance.now() - t0) : null;
    if (r) {
      result.worker = { ms: r.elapsedMs, bytes: r.blob.size };
      const wRgba = await blobToRgba(r.blob);
      if (wRgba) {
        result.diffGpuVsWorker = gpu && gpuRgba ? rgbaDiff(gpuRgba, wRgba) : null;
        result.diffWorkerVsCpu = rgbaDiff(wRgba, cpuRgba);
      }
    }
  } else {
    result.workerReady = false;
  }
  result.sideBySide = sideBySide;
  return result;
}

// ─── QA local (__techTools) ─────────────────────────────────────────────────

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
      enhanceViaWebGPU,
      unsharpViaWebGPU,
      resetGpuContext,
      lastGpuError: () => lastGpuError,
      bench: benchmarkEnhanceRoutes,
      compareText: compareTextRoutes,
      synthDocCanvas,
    };
  } catch {
    /* SSR */
  }
}
