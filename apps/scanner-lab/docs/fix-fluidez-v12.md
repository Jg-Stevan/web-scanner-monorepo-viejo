# FIX v12 — Fluidez de captura en gama baja: editor primero + análisis adaptativo

> **APP:** `apps/scanner-lab` + `packages/scanner-core` · **Base:** `main` en `255db2d` (v9+v10+v11 fusionados).
> **Rama:** `fix/fluidez-gama-baja-v12` · **3 commits de código + 1 docs.**
> `apps/digitalizador-e14`: **0 archivos tocados.** · **PR ABIERTO, SIN FUSIONAR.**

## Diagnóstico (por qué la cámara «se queda» procesando)

Cadena tras el disparo (auto-captura u obturador, camino con foto full-sensor), ANTES de v12:

| Paso | Código (CameraView, pre-v12) | Coste en gama baja |
|------|--------|--------------------|
| 1. `takePhotoBlob()` | ~1019 | **0,5–3 s** (HAL de la cámara; NO reducible — es la foto del sensor, intocable) |
| 2. `blobToDataUrl` | ~1365 | ~ms (FileReader) |
| 3. `loadImage(rawDataUrl)` — decode 12 MP completo | ~899 | **0,5–1,5 s** |
| 4. `downscaleImage(decoded, 4032)` | ~906 | null si ≤4032 (8–12 MP: nada); si 13 MP: **re-encode JPEG completo 1–3 s** |
| 5. si hubo downscale: `loadImage` OTRA VEZ | ~909 | **otro decode completo** |
| 6. `evaluateQuality` (canvas ≤400 px) | ~914 | barato |
| 7. `addCapturePage` + `setView("editor")` | ~967-969 | recién AQUÍ abre el editor |

→ **Tiempo total con la cámara abierta: 2–8 s en gama baja.** El usuario ve el overlay detectando, dispara, y el visor se congela «un rato» sin feedback.

**Clave:** los pasos 3–5 existen SOLO para (a) medir calidad, (b) conocer el aspect para el quad nato, (c) capar a 4032 — y (c) casi nunca aplica: `takePhotoBlob` YA pide ≤4032 a la HAL (sensor-profiler, capa 1) y `clampBlobToSafeCap` es la capa 2. El decode completo se puede sacar del camino crítico.

**Lentitud general de la cámara:** el bucle de análisis remuestreaba SIEMPRE a 400 px y corre OpenCV WASM en el worker: en CPUs gama baja cada análisis tarda 200–400 ms → 2,5–5 fps → overlay de esquinas entrecortado + competencia de CPU con el video. Además el WASM se cargaba durante el arranque de la app (compitiendo con la hidratación).

## Cambios (3 commits)

### Commit 1 — `a9a1898` — 12.1: «Editor primero», captura no bloqueante

- **12.1a — Probe rápido en vez de decode completo** (`image-processor.ts` + `detector-client.ts` + camino de foto de `CameraView`): ANTES de `blobToDataUrl` se crea `probe = createImageBitmap(photoBlob, { resizeWidth: 400, resizeQuality: "low" })` — bitmap diminuto con el ASPECT exacto de la foto. `ImageSource` (y `ensureDecoded`/`sourceWidth/Height`/`detect()`) acepta `ImageBitmap` → el probe alimenta `evaluateQuality` (que ya trabaja a ≤400 px) y la puerta del quad nato (±2 % del frame del video) SIN decode completo. Flag QA `window.__disableProbe = true` fuerza el fallback.
- **12.1b — Store + editor inmediato**: `handleCaptureDataUrl(rawDataUrl, probe?)`:
  - **Con probe** (foto del sensor o canvas del burst): CERO decodes completos y cero re-encodes en el camino crítico → `evaluateQuality(probe)` → quad nato (aspect del probe) → `addCapturePage` (original = foto SIN cap sincrónico) → **`setView("editor")` inmediato**.
  - **Sin probe** (createImageBitmap no disponible/falló, galería, demo): camino ACTUAL intacto (decode + cap + quality) — red de compatibilidad.
  - **Canvas del burst** (`dispatchBestFrame`): el canvas del GANADOR pasa como fuente (dims conocidas, ≤1920 → sin cap posible); su backing store lo libera `closeProbe` en el finally; los perdedores se sueltan como siempre (R-14).
- **12.1c — UN decode completo EN BACKGROUND** (`scheduleBackgroundResolve`, setTimeout ~2500 ms tras navegar para no competir con el primer `processImage` del editor): decode del original → si >4032 (raro: 3ª red) `downscaleImage` + `updateCapturePage({ original: capado })`; si `autoQuadPending` → `detectDocumentEdges` full-res + `applyAutoQuad` (mismo de hoy, alimentado por ESTE decode); si ni cap ni pendiente → nada. Canvas del burst con quad nato → NI el decode corre (ahorro total). Guards de existencia antes de cada `updateCapturePage` (la página puede haber sido eliminada).
- **12.1d — Galería sin cambios**: `onFilePicked`/`fileToCaptureDataUrl` (cap 4032 JPEG 0.92) intactos.

### Commit 2 — `e2f5020` — 12.2 + 12.3: análisis adaptativo + feedback

- **12.2a — Resolución de análisis dinámica** (`frame-loop.ts`): medición de la duración REAL de cada análisis (createImageBitmap + worker) → ventana móvil de 10 → **mediana**: ≤200 ms → 400 px · >200 ms → 320 px · >300 ms → 280 px (piso). **Histéresis**: bajar tras 1 ventana mala; subir tras 3 buenas consecutivas y de UN nivel (280→320→400). El historial de estabilidad SIEMPRE se guarda en referencia FIJA 400-clase (`refScale`) — una baja de resolución NO es un salto del documento; a 400 px el mapeo es bit a bit el de siempre. **SOLO el análisis cambia, NUNCA los datos**: corners normalizados 0–1 (overlay igual) y el QUAD de guardado nace del overlay vivo (bornQuad) o de la re-detección full-res en background — igual que hoy. Telemetría `__analysisW`/`__analysisMs`. Reset por sesión (como el throttle F-PERF).
- **12.2b — Precalentamiento del detector al abrir la app** (`page.tsx`): el arranque del worker + OpenCV WASM (1–3 s en gama baja) se difiere a `requestIdleCallback` (fallback `setTimeout` 1500), UNA vez por sesión, silencioso si falla. Reutiliza `warmUpScannerWorker` + `setWarpCap` de `detector-client` — sin worker duplicado; si el usuario abre la cámara antes, el propio loop arranca el worker y esto es un no-op. Telemetría `__prewarm = { ok, ms }`.
- **12.2c — Ceder CPU durante el post-captura** (`CameraView`): con `processingRef.current === true` (del disparo a la navegación) → `loop.setIdle(true)` (API del modo espera v5 4) y `setIdle(false)` al liberar — el análisis deja de competir con el decode/encode por la única CPU grande del equipo. El stream no se toca.
- **12.3 — Pill «Abriendo editor…»**: `takePhotoBlob` (0,5–3 s) no se puede acortar — es la foto del sensor. Pero ese tramo era silencioso. Pill de progreso (patrón de «Ajustando recorte…», Loader2 + texto) visible desde el disparo (`onShutter`/`onTrigger`) hasta `setView("editor")` **solo si supera 300 ms** (en gama alta ni aparece — sin parpadeo). Liberación en TODAS las rutas sin editor (stream muerto, burst vacío, encode fallido, cooldown/processing) + tope duro 12 s. **Progreso, no calidad** (toasts de calidad prohibidos desde v7).

### Commit 3 — 12.4: telemetría QA + esta documentación

- `window.__captureToEditor` — ms entre el disparo (t0 en `onShutter`/`onTrigger`) y `setView("editor")`. La galería no marca t0 (ruta ajena a la captura).
- `window.__analysisW` / `window.__analysisMs` — lado mayor de análisis vigente / mediana de duración (12.2a).
- `window.__prewarm = { ok, ms }` — precalentamiento del detector (12.2b).
- Intactas de v9/v11: `__lastShutter`, `__displayMax=4032`, `__displayUrlCalls=0`, `__editorSource`.

## Qué NO se tocó

- **v9 completo** (ventana 1200 ms, K dinámico 70 %, SUSTAIN 400 ms, gapTolerance dinámica, `__lastShutter`, MAX_HISTORY 36) — gates y cooldown 1500 ms intactos.
- **Ranking v7.3** (puerta de nitidez 0.85 → gana resolución), **F-RES-PRIORITY v6.1** (foto full-sensor siempre gana), ring 1280, `CAN_TAKEPHOTO`, reglas E3, timeout 5 s de takePhoto, flash auto v5.5.
- **Fuente única v11** (editor/presentación consumen el PNG 4032; `makeDisplayUrl` seam apagado), **v10-B** (sin chip), pan PR #21, LRU de previews en 6, miniaturas.
- **`PROCESSED_MAX_LONG_SIDE = 4032`**, export máxima, watchdog/recuperación de stream v4/v6.
- El **fallback sin probe** es EXACTO el comportamiento actual (red de compatibilidad).
- ⛔ `apps/digitalizador-e14` — 0 archivos.

## Criterios de aceptación verificados

- Diff solo `apps/scanner-lab` + `packages/scanner-core` — **0 archivos e14**.
- Con probe: **cero decodes completos y cero re-encodes entre el disparo y `setView("editor")`** (auditoría camino a camino: snapshotVideo dibuja el video vivo, `takePhotoBlob` es la HAL intocable — su `clampBlobToSafeCap` es la capa 2 preexistente —, probe ≤400 px, quality canvas 120 px, store, navigate).
- `tsc --noEmit` core=0 y app=0 · `eslint`=0 · sin build.
- Telemetrías presentes: `__captureToEditor`, `__analysisW`, `__analysisMs`, `__prewarm` + v9/v11 intactas.
- Fallback sin probe verificable con `window.__disableProbe = true` (flag QA) → comportamiento idéntico al actual.
- E2E: import por galería sigue funcionando (12.1d); captura sintética → editor abre; telemetría legible.

## Protocolo de medición (dueño, gama baja, con el preview de v12)

Repetir 3 capturas manuales y 1 auto, anotando la sensación:

1. ¿El editor abre ahora «al instante» tras el flash?
2. ¿El overlay de esquinas va más fluido que antes?
3. ¿La primera apertura de cámara es más rápida (precalentamiento)?

Comparar contra la versión actual si es posible. Reportar `__captureToEditor` (consola remota o pedírselo al agente). Telemetrías completas en consola:

```js
__captureToEditor   // ms disparo → editor (el objetivo: ≈ el de la HAL)
__analysisW         // 400/320/280 — lado mayor de análisis vigente
__analysisMs        // mediana de duración del análisis (ms)
__prewarm           // { ok, ms } — OpenCV precalentado en idle
```

---

## 12.5 — FIX v12b: «Editor inmediato» (la cámara desaparece EN el disparo)

> Commits `2272af6` (12.5a–e) + uno de docs/telemetría (12.5f–g). Mismo PR #27.

### Diagnóstico (QA físico del dueño con el preview v12)

La pill «Abriendo editor…» aparecía, PERO la cámara seguía en pantalla durante toda la ventana del disparo (0,5–3 s de `takePhotoBlob`) → parecía que la auto-captura no ocurrió. La causa es arquitectural: `page.tsx` monta las vistas en exclusiva (`{view === "camera" && <CameraView />}`) → navegar antes de tener la foto desmontaría la cámara y mataría el stream a mitad de la HAL.

### Decisión de UX del dueño

Al disparar (auto u obturador), la cámara debe DESAPARECER al instante y el editor abrir de inmediato mostrando una **pantalla de carga** hasta que la foto esté lista. La ventana de la HAL no se puede acortar — pero se vive DENTRO del editor, no viendo la cámara.

### Cambios

- **12.5a — `store.ts` (ADITIVO):** `capturePending: boolean` + `setCapturePending(v)` — «hay un disparo en vuelo y el editor debe mostrar pantalla de carga».
- **12.5b — `onTrigger` (auto) y rama con stream de `onShutter` (manual):** tras marcar t0 + pill → `captureEpochRef += 1` · `setCapturePending(true)` · `setView("editor")` — el editor abre en el MISMO tick del disparo (≈0 ms). La rama NATIVA iOS (`captureInputRef.click()`) y la galería/demo NO navegan con pantalla de carga (regla 5: la UI del SO cubre la pantalla; la galería tiene su toast).
- **12.5c — `page.tsx`, capa ESTÁTICA de cámara:** `CameraView` se monta cuando `view === "camera" || capturePending`, OCULTA con la clase `hidden` (display:none, instantáneo) cuando `view !== "camera"`. UNA sola instancia de `<video>` en el DOM (nunca dos — conflicto de stream). El stream NO se pausa: `takePhotoBlob` vive en el track y el fallback ZSL lee el video con `drawImage`. La capa keyed (editor/biblioteca/ajustes) sigue animándose POR ENCIMA. Escape ignorado durante pending (el editor es una pantalla de carga, no una vista que abandonar).
- **12.5d — aterrizaje:** en `handleCaptureDataUrl`, AMBOS caminos (probe y fallback) hacen `setCapturePending(false)` tras `addCapturePage(page)`; el `setView("editor")` existente SE QUEDA (idempotente; es el que navega galería/demo).
- **12.5e — TODAS las salidas por fallo limpian el pending** y devuelven a la cámara CON el stream vivo (sin reabrir): early-returns de `runCaptureFlow` (processing/cooldown), burst vacío (stream muerto → recoverStream, o vivo → B8), encode fallido, timeout v4 + stream muerto/congelado, y el catch de `handleCaptureDataUrl` (decode). **Guard anti-carrera por época**: cada disparo incrementa `captureEpochRef`; un cleanup tardío cuya época no coincide NO toca el disparo nuevo. Bonus: cancelar la cámara nativa iOS (`!file` en `onFilePicked`) libera la pill 12.3 (antes quedaba clavada hasta el tope de 12 s) y mata el t0 huérfano.
- **12.5f — pantalla de carga del editor (`EditorView`):** overlay `absolute inset-0 z-50` opaco, `role="status"` + `aria-live="polite"` + `aria-busy="true"`, selector QA `data-capture-loading`, mismo copy/estilo de la pill 12.3 (Loader2 azul + «Abriendo editor…»). SIN animación de entrada: debe existir desde el primer paint (sin flash de la escena vacía ni de la página previa). Bloquea toda interacción (header/visor/toolbar) hasta que la página aterriza. El flujo de datos del editor NO se toca (fuente única v11, processImage, quad).
- **12.5g — telemetría:** `window.__captureT0` (espejo del t0 del disparo, lo fija el trigger) → el propio `EditorView` al montar mide **`__captureToEditor` = disparo→editor VISIBLE (≈0–100 ms)**; el aterrizaje mide **`__captureToPage` = disparo→`addCapturePage`** (el trabajo real: HAL + probe). Ambos ceros los limpian el aterrizaje y las salidas por fallo. El resto de telemetrías v9/v11/v12 intactas.

### Notas técnicas (por qué es seguro ocultar el video)

- Con `display:none` el latido rVFC puede congelarse (Chromium no dispara `requestVideoFrameCallback` para videos que no se pintan) → `lastFrameAtRef` viejo. NO es problema: el watchdog v4/v6 está suprimido durante el disparo (`capturingRef`), y el pending termina (aterrizaje o limpieza) antes de acumular los 2 strikes consecutivos que exigiría. El único efecto: en el RARO timeout de `takePhoto` (5 s), el chequeo de frescura de v6 6.2 ya no distingue «vivo pero oculto» de «congelado» → recupera conservador (camino de fallo ya diseñado para eso).
- La cámara sintética (QA) usa un canvas FUERA del DOM + `captureStream(12)` con rAF de página visible → sigue produciendo frames durante el pending.
- El ring ZSL de la captura EN VUELO ya tiene sus frames (ventana 80–450 ms pre-tap, capturados antes de ocultar); `snapA` se toma en el mismo tick del disparo (antes del re-render).

### Criterios de aceptación (PR #27)

- [x] Diff acumulado 0 archivos e14 · tsc core=0 app=0 · eslint=0.
- [x] E2E: disparo → visor desaparece + overlay `[data-capture-loading]` presente en <300 ms → página aparece → pending limpia.
- [x] Durante el pending: `document.querySelectorAll("video").length === 1` (sin remount ni reabrir cámara).
- [x] Camino de fallo (código + análisis): pending limpia y vuelve a cámara con stream vivo.
- [x] Galería y demo SIN pending (su navegación nace de `handleCaptureDataUrl` como siempre).
- [x] `__captureToEditor` ≈0–100 ms · `__captureToPage` ≈ HAL · v9/v11 intactas.
- [ ] QA físico del dueño (protocolo de abajo) + decisión de merge.

### Protocolo QA del dueño (v12b, con el preview)

1. Dispara auto → ¿la cámara desaparece AL INSTANTE y ves la pantalla de carga del editor?
2. ¿La página aparece sola al estar lista?
3. Obturador manual → mismo comportamiento.
4. «Repetir» → ¿la cámara vuelve VIVA y puedes volver a capturar?
5. Primera captura tras abrir la app (prewarm) → ¿todo sigue fluido?

---

*Fin de la spec v12. El objetivo: que el tiempo percibido entre disparo y editor sea ≈ el de `takePhotoBlob` (la HAL), nada más; y que el visor vivo deje de pelear por la CPU en gama baja.*
