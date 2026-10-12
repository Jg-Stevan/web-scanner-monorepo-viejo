# PLAN B — Tecnologías modernas Android-first (WebCodecs + WebGPU + captura alta resolución experimental)

> Rama `plan-b-tech-moderna` desde `main` (`bb2aa8f`). **PR draft — el dueño decide.**
> Compite con el PLAN A (rama `plan-a-memoria-render`): la sonda §7 y el
> protocolo de QA §8 son IDÉNTICOS en ambos planes para que las comparaciones
> sean válidas.

**Hipótesis**: las APIs web modernas (WebCodecs `ImageDecoder`, WebGPU) permiten
decodificar y procesar imágenes grandes sin el muro de memoria del canvas 2D, y
en dispositivos capaces (opt-in) capturar por encima de 4032 px para bajar por
supersampling a 4032 en el export (posible mejora de nitidez/ruido real).

**Filosofía de seguridad**: TODO es feature-detected. En un dispositivo sin las
APIs nuevas, la app se comporta **idéntica a `main`** (demostrado en §5).

---

## 1. Arquitectura (qué se añadió y dónde)

```
packages/scanner-core/src/
├── tech-capabilities.ts   (NUEVO — B1)  Detección por sesión: ImageDecoder,
│                                        WebGPU (requestAdapter real, compartido),
│                                        deviceMemory, hardwareConcurrency,
│                                        OffscreenCanvas-en-worker (sondeo blob),
│                                        isIOSOrSafari. window.__techCaps (getter).
│                                        + toggle B4 (localStorage scannerlab-hi-res-beta,
│                                        SIN tocar el store) + registro del SensorProfile
│                                        que publica CameraView + buildHiResPhotoSettings
│                                        (pick de rangos idéntico a buildCappedPhotoSettings,
│                                        objetivo 6000) + flags QA (§5).
├── webcodecs-decode.ts    (NUEVO — B2)  Blob → ImageDecoder → ImageBitmap (sin <img>).
│                                        Lector EXIF propio (tag 0x0112) + transformación
│                                        con las MISMAS matrices del navegador (ImageDecoder
│                                        NO aplica EXIF — sin esto las fotos rotadas
│                                        llegarían trastocadas). supersampleBlobToStandardCap
│                                        (§6): >4032 → 4032 en UN paso createImageBitmap
│                                        resizeQuality:'high'. Fallback POR LLAMADA → null.
├── webgpu-enhance.ts      (NUEVO — B3)  Ruta WGSL del filtro «Texto claro» (puerto EXACTO
│                                        de enhanceToRgba("text") — ver §3) + unsharp
│                                        separable (k7 σ1.5, pesos de image-modes) +
│                                        benchmarkEnhanceRoutes + compareTextRoutes (QA).
└── image-processor.ts     (MODIF)       ImageSource += ImageBitmap; processImage decodifica
                                         strings vía B2 primero (fallback <img> por llamada);
                                         el enhance «text» intenta GPU primero (fallback
                                         worker WASM por llamada); unsharpOriginal GPU primero.
```

```
apps/scanner-lab/src/
├── lib/perf-probe.ts               (NUEVO — §7) window.__perfProbe — API exacta de la spec.
├── components/scanner/CameraView   (MODIF — B4)  photoSettings hasta 6000 con toggle ON
│                                                  (capas de defensa INTACTAS — solo cambia
│                                                  el objetivo del pick) + supersampling §6
│                                                  del blob >4032 + registro del perfil +
│                                                  mark("capture_fired").
├── components/scanner/EditorView   (MODIF — §7)  marks: editor_open, editor_first_render,
│                                                  filter_applied{ms,engine}, page_saved,
│                                                  save_done, export_start/export_end.
└── components/scanner/SettingsView (MODIF — B4)  Sección «Experimental» — toggle INVISIBLE
                                                   salvo condiciones §4 (único UI nuevo).
```

**Intocados (reglas §2)**: `apps/digitalizador-e14` (0 líneas), `store.ts`,
`page-store`, export PDF/ZIP, gates de auto-captura v9, detector, frame-loop,
ZSL, `sensor-profiler.ts` (solo se CONSUME `SensorProfile` — import type),
procesado WASM del worker (queda como fallback intacto).

---

## 2. B4 — Modo «Captura alta resolución (beta)»

**Visibilidad del toggle (Ajustes › Experimental)** — se cumplen TODAS o la
sección no existe (ni en el DOM):

1. `ImageDecoder` disponible (WebCodecs)
2. `navigator.gpu` con `requestAdapter()` exitoso (WebGPU)
3. `deviceMemory ≥ 8` (clase 8 GB)
4. `sensorProfile.nativeLongSide > 4032` (el perfil lo publica CameraView al
   sondear el sensor — **abre la cámara una vez en la sesión** para que Ajustes
   pueda evaluarlo)
5. NO es iPhone/iPad/Safari

**Con toggle ON** (re-evaluado EN VIVO en cada disparo, conservador):
- `photoSettings` pide al ISP hasta **6000 px** de lado mayor con la MISMA
  lógica min/max/step de `buildCappedPhotoSettings` (las 2 capas de defensa del
  sensor-profiler quedan intactas; solo cambia el objetivo del pick).
- El blob resultante baja por **supersampling en UN paso** (§6) al export
  estándar: `createImageBitmap(..., { resizeQuality: "high" })` → JPEG 0.92
  (mismo encode que la capa 2 clásica).
- Si el blob ya es ≤ 4032 (sensor que mintió su nativa, photoSettings
  ignorado): pasa **INTACTO** (nunca se procesa por debajo de 4032).
- Ante cualquier fallo del supersampling → **capa 2 clásica**
  (`clampBlobToSafeCap`) → la app nunca queda desprotegida.

**`overCap` (sensor que miente su resolución)**: documentado — el paso de
supersampling actúa como red de seguridad adicional: cualquier blob > 4032
(venga de donde venga) baja a 4032 en un único paso de calidad ANTES de entrar
al pipeline; nada por encima de 4032 se decodifica jamás en el flujo normal y
nada por debajo se re-escala.

**El export NO cambia** (regla 2): tope 4032, q0.95, una codificación final.
El supersampling TERMINA en el export estándar.

---

## 3. B3 — Ruta WGSL del «Texto claro» (equivalencia)

Puerto píxel-exacto de `enhanceToRgba("text")` de `image-modes.ts` (la misma
matemática del DetectionWorker):

| Paso (JS de referencia) | Implementación WGSL |
|---|---|
| `rgbaToGray` — luma entera `(R·77+G·150+B·29)>>8` | compute `csGray` → buffer u32 |
| `sampleDownscale` (nearest ≤800 px) | compute `csDown` (fórmula idéntica) |
| `morphClose` kernel 25 (deque monótono) | 4 computes `csClose` separables max/max/min/min (ventana centrada y acotada — equivalente) |
| media del mapa → `gains = mean/map` | átomics u32 (suma EXACTA: enteros) + compute `csGains` |
| `correctedGrayWithModel` — gains BILINEAL | `bilinearGain` en shader (fórmula exacta `fx=(x·mw)/w`) |
| `whitePointStretchPct(0.95)` — percentil | histograma GPU con atómicos → 1 readback de 1 KB → pivot/scale en CPU |
| `textTargetLumaLut` (sigmoidal) | LUT construida EN CPU con la MISMA función importada de image-modes → buffer |
| `edgeAwareSharpenGray` (grad 25, amount 0.75) | `csText` (vecinos vía LUT, márgenes 1 px sin procesar) |
| `rebuildRgbaWithChroma` (253/45/200/1.5) | `csText` (constantes congeladas) |

**Salida sin render pass**: la textura final se lee con
`copyTextureToBuffer` (alineación 256) → `ImageData` → PNG por canvas 2D.
Universal (hardware, SwiftShader, sin swapchain), sin volteos Y y sin
`convertToBlob` sobre contexto webgpu.

**Diferencias posibles vs WASM**: redondeo f32-vs-f64 y half-up-vs-half-even
en puntos exactos .5 — medidas en sandbox (documento sintético 640 px):
`meanAbs 0.001/255 · pctGt2 0.02 % · pctGt8 0 %` (worker≡CPU es 0 exacto).
Sin halos ni banding por construcción (funciones continuas por píxel).

**Cobertura**: `text` (el filtro insignia) + `unsharp` (Original + toggle de
nitidez). **`bw` NO se portó**: Bradley-Roth necesita imagen integral y el
despeckle es flood-fill serial — la ruta WASM/worker lo sirve (fallback
intacto). `raw` sigue en el worker. Cualquier fallo de GPU (adapter, OOM,
device perdido, pipeline inválido) → fallback **por llamada** al worker.

**Benchmark** (herramienta: `__techTools.bench([2048, 4032])` — consola):
corre las 3 rutas (GPU / worker WASM / CPU exacto) con warmup + N corridas.
Números de sandbox (SwiftShader SOFTWARE, no representativos de hardware —
el dueño debe correrlo en su dispositivo):

| Tamaño | GPU (software) | WASM worker | CPU exacto |
|---|---|---|---|
| 1024 px | 631 ms | 145 ms | 131 ms |
| 512 px | 304 ms | 81 ms | 65 ms |

**Equivalencia** (herramienta: `__techTools.compareText(1024)`): diff pixel a
pixel GPU vs CPU exacto vs worker + composite lado a lado para inspección.

---

## 4. B2 — Decodificación WebCodecs

`processImage` (la materialización del editor y la alimentación del
procesado): si la fuente es un data URL y `ImageDecoder` existe, la
decodificación va por WebCodecs (fuera del hilo principal) con **EXIF
aplicado por nosotros** (ImageDecoder no lo hace): lector del tag 0x0112 +
transformación canónica (`applyExifOrientation`) SOLO cuando orientation ≠ 1.
Fallback POR LLAMADA al `<img>` clásico ante cualquier fallo.

Evidencia sandbox (`__techTools.exifSelfTest()`): JPEG sintético 64×32 con
APP1 orientation=6 inyectado → decodifica 32×64 con la rotación 90° CW
correcta verificada por píxeles (arriba roja / abajo azul) — **PASS**.

---

## 5. B5 — No-regresión garantizada (demostración)

**Flag QA**: `localStorage.setItem("scannerlab-qa-empty-tech-caps", "1")` (o
`window.__qaEmptyTechCaps = true` antes de cargar) + recargar. Efecto:

- `__techCaps` = vacías (imageDecoder/webgpu false, deviceMemory null…)
- B2 apagado (`webcodecsDecodeAvailable()` consulta el flag) → `<img>` clásico
- B3 apagado (`getGpuContext()` consulta el flag) → worker WASM
- Toggle invisible (las condiciones §2 no se cumplen)

Evidencia sandbox con el flag: captura → editor → `filter_applied
{engine:"worker"}` → guardar → 0 errores, `__crashLog` 0 — **comportamiento
y salidas idénticos a main**. Verificado también el caso inverso (adapter null
sin flag → la ruta GPU degrada sola al worker).

**Overrides QA** (solo consola, para probar la UI sin el hardware):
`window.__qaTechCapsOverride = {...}` + `__techTools.setSensorProfileQA({...})`
→ permite ver el toggle Experimental y probar el flujo completo con el modo
activo (captura sin regresión aunque la foto sea ≤ 4032: passthrough intacto).

---

## 6. §7 — Sonda de rendimiento (`window.__perfProbe`)

API exacta de la spec: `marks []` · `mark(ev, meta?)` · `memory()` ·
`longTasks {count,totalMs}` · `fpsSample(ms=3000)` · `report()` (console.table).
Eventos instrumentados (sin tocar lógica — solo llamadas mark):

`capture_fired` (runCaptureFlow) · `editor_open` (montaje del editor) ·
`editor_first_render {engine,cached,ms}` · `filter_applied {ms,engine,filter}`
· `page_saved {bytes,pxLong}` · `save_done {ms,bytes}` ·
`export_start/export_end {type:pdf|png|jpg, ms, bytes}`.

Telemetrías adicionales del plan: `window.__techCaps` (caps) ·
`__techTools.lastGpuError()` (por qué la GPU no sirvió, si aplica) ·
`__lastEnhanceRoute` ("gpu"|"worker" — ruta del último enhance) ·
`__techTools.lastHiRes()` (srcLong/outLong/via/ms del último supersampling).

---

## 7. Verificación E2E realizada (sandbox, cámara sintética + SwiftShader)

| Verificación | Resultado |
|---|---|
| tsc core + app, eslint | 0 errores |
| `__perfProbe` — 8 eventos en flujo real (captura→editor→filtros→guardar→export png/pdf) | ✅ todos con meta correcta |
| `memory()/longTasks/fpsSample/report()` | ✅ (heap 24 MB · longTasks 48/8.6 s · fps 61) |
| B2 `exifSelfTest` | ✅ PASS total |
| §6 `supersampleTest` 5000→4032 | ✅ vía webcodecs, un paso |
| Filtro «Texto claro» en el flujo REAL | ✅ `__lastEnhanceRoute: "gpu"`, preview 1816×2442, VLM: papel blanco/texto nítido/sin halos |
| Equivalencia `compareText` | ✅ diff 0.001/0.02 % (worker≡CPU exacto) |
| `unsharpViaWebGPU` | ✅ (tras fix WGSL) luma y overshoot correctos |
| Toggle B4 (overrides QA) | ✅ visible solo con condiciones, ON→captura sin regresión, persiste en localStorage |
| B5 flag caps vacías | ✅ app idéntica a main + toggle oculto |
| Telemetrías v11/v9 intactas | ✅ `__displayMax` 4032 · `__editorSource` preview-url · `__crashLog` 0 |
| `apps/digitalizador-e14` | 0 líneas tocadas |

Bugs encontrados y corregidos durante el E2E (valioso para el historial):
1. `queue.submit()` exige array en Chrome actual (pasar el command buffer
   suelto lanza TypeError).
2. Los recursos texture/sampler de los bind groups van DIRECTOS (no
   `{texture:…}` — solo los buffers van envueltos).
3. WGSL prohíbe `vec2<i32>(u32, i32)` (tipos mixtos) — pipeline inválido
   **silencioso**; añadida red anti-fallo (salida con alpha 0 generalizado →
   fallback).
4. Los render passes a canvas WebGPU crashean SwiftShader headless → salida
   rediseñada por `copyTextureToBuffer` (más simple y universal).

---

## 8. Protocolo de QA del dueño (§8 de la spec — tal cual)

Mismo dispositivo, mismos 5 documentos, misma iluminación, comparando contra
`main`:
1. Recibo con texto pequeño — 2. Hoja A4 texto — 3. Página con foto a color —
4. Documento en poca luz — 5. Hoja arrugada.

Flujo por documento: captura auto → editar (pan/zoom 10 s + probar filtros) →
guardar → al final exportar PDF «máxima» + ZIP.

Anotar: heap pico (`__perfProbe.memory()`), long tasks, FPS editor
(`__perfProbe.fpsSample()`), tiempos save/export, tamaños de archivo, calidad
subjetiva (bordes de texto, halos, ruido, color) 1–5 por documento.

**Extra del Plan B**: repetir 3 documentos con el modo alta resolución ON y
comparar nitidez 6000→4032 vs nativa 4032 (`__techTools.lastHiRes()` da
srcLong/outLong/via/ms de cada captura). Además, en consola:
`__techCaps` · `__techTools.bench([2048, 4032])` · `__techTools.compareText(2048)`.
