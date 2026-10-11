# CHANGES — Mejoras de cámara, rendimiento y filtros

> Delta sobre el upstream `Jg-Stevan/web-scanner` (rama `main`).
> Todos los cambios están verificados con `eslint`, `tsc --noEmit` y pruebas E2E en navegador (flujo completo: onboarding → biblioteca → cámara con detección OpenCV → captura manual y automática → editor con filtros → exportar PDF → persistencia IndexedDB), sin errores de consola.
> Rama de trabajo local: `fix/camera-stabilizer-perf`.

## 0. FIX v3 — Calidad del editor WYSIWYG + presentación iOS + benchmark fuera (rama `fix/scanner-lab-editor-quality`)

**Regla del propietario:** "guardar la captura en lo máximo del lente, sin ajustes por benchmark". Documentación completa del fix (plan, decisiones, evidencia de verificación): `apps/scanner-lab/docs/fix-editor-quality-v3.md`.

**Cambios:**

- **Tope técnico ÚNICO exportado** — `PROCESSED_MAX_LONG_SIDE = 4032` px (`image-processor.ts`, antes module-private). Preview del editor (2 usos) y guardado (4 llamadas de `processImage` en `store.ts`) usan LA MISMA constante → **WYSIWYG estricto por construcción** (verificado: chip == `naturalWidth/Height` del preview).
- **Benchmark F-DEVBENCH ELIMINADO** — `device-capability.ts` borrado, su UI ("Rendimiento del dispositivo") fuera de Ajustes (queda fila estática "Resolución de procesado — 4032 px"), `setWarpCap(4032)` fijo, key `escaner-device-cap-v1` limpiada al arrancar, `rg` de todos los identificadores → 0 resultados. La protección de sensores gigantes (48/108 MP) del `sensor-profiler` se CONSERVA (`overCap`, `buildCappedPhotoSettings`, `clampBlobToSafeCap`); `getSensorSafeCap()` ahora devuelve 4032 fijo y el campo `tier` desaparece de `SensorProfile`.
- **Rotar sin degradar (F-ROT-RAPID + calidad)** — la rotación rápida solo marca `processed/processedKey` si la imagen conserva la resolución objetivo (`min(4032, máx(aristas del quad en px del original))`, tolerancia 0.9 — misma geometría que `warpQuadToCanvas`); si no, el store **reprocesa a tope al guardar**. Defensa extra en la rama `processedValid` del merge (`processedMeetsTarget`): una procesada materialmente inferior al objetivo jamás llega al documento como "final" (red de seguridad contra 3200/2600 heredados).
- **iPhone: stream de auto-captura 1920×1440** — `IDEAL_PREVIEW_*` condicionado a la ausencia de `ImageCapture` (proxy iOS): los originales de la auto-captura pasan de 960 px (0.5 MP) a ≥1920 px. El disparo manual sigue por cámara nativa (12 MP). El ORIGINAL ya no se re-escala a tope de gama (downscale a 4032 fijo). Toast "Cámara lenta" solo si el frame es realmente bajo (<1280 px).
- **Presentación fullscreen (bug iOS)** — wrapper de tamaño DEFINITIVO (`h-full w-full`, antes altura auto: iOS Safari no resolvía el `max-height:100%` y la foto desbordaba recortada), `clampPan`/`clampZoomPan` con la fórmula correcta `(imgW×s − stageW)/2` (fin del sobre-paneo con huecos negros — verificado pixel-perfect: 75.61 px medidos vs 75.6 teóricos), `presentationPages` se construye AL ABRIR con lectura fresca de la caché (antes un `useMemo` que leía un ref mostraba la foto ORIGINAL sin recortar en páginas no visitadas) y `will-change` solo durante el gesto (rasterizado iOS).
- **PDF "standard" a tamaño completo de serie** — `ATTEMPTS_STANDARD[0] = { longSide: 0, quality: 0.9 }` (antes recortaba a 2600 px aunque la página fuera de 4032); la escalera por presupuesto de bytes se mantiene como respaldo.
- **Chip "Se guardará: {calidad} · {WxH} px"** en el editor (transparencia WYSIWYG) con drawer Estándar/Alta/Máxima (mismo patrón que el sheet de Filtros, cambia `settings.exportQuality` sin salir del editor).
- **LRU de previews 12 → 6 entradas** — mitigación de memoria obligatoria al procesar todo a 4032 (entradas de ~el doble; mismo presupuesto total, sin riesgo de jetsam en sesiones largas).

**Verificado:** `tsc` core + app, `eslint`, y E2E en navegador (Ajustes sin benchmark, chip WYSIWYG con dimensiones exactas, rotación que conserva resolución, clamp de paneo pixel-perfect, merge al salir, captura → guardar). Pendiente: QA en iPhone Safari físico (bug 1.1 solo visible ahí).

> **🔀 Mergeado:** PR #10 → `main` en `6aa7c14` (solo scanner-lab + scanner-core; e14 completamente intocado — corrección de alcance v3.1). CI verde: Deploy to GitHub Pages `success` — `/lab/` y raíz respondiendo 200 con el build nuevo. Registro completo de la ejecución: `apps/scanner-lab/docs/fix-editor-quality-v3.md`.

---

## 0-bis. FIX v4 — Recuperación de cámara negra tras «Cámara lenta» (rama `fix/camera-black-recovery-v4`)

**Síntoma del propietario:** al capturar aparece el toast «Cámara lenta: baja resolución esta vez» y después la captura nunca se muestra y la cámara queda **negra para siempre**. Causa raíz: 5 defectos encadenados. Documentación completa (plan, decisiones, evidencia): `apps/scanner-lab/docs/fix-camera-black-v4.md`.

**Cambios (todos en `CameraView.tsx`):**

- **4.1 Un solo `takePhoto` de 5 s** (antes 8 s + reintento = 16 s congelado). Reintento solo si el primer intento falló rápido; un timeout = sensor colgado → **lista negra temporal** (`takePhotoBrokenRef`): mientras esté marcada, los disparos van directos al fallback de frames (2º disparo medido: 21 ms vs ~5300).
- **4.2 Obturador bloqueado durante TODO el disparo** (`capturingRef` + `isCapturing` + `try/finally` simétrico): fin de los N `takePhoto()` simultáneos por toques repetidos (cascada de `InvalidStateError` → sensor roto).
- **4.3 ⚠️ Watchdog de salud del stream (la causa del negro permanente):** un track puede morir EN SILENCIO (`muted`/sin frames con `readyState "live"`) sin disparar jamás `ended`. Cada 2 s (2 strikes, gracia de 8 s, sin contar durante disparos) → `recoverStream()`: para el stream y re-dispara el efecto de apertura. Verificado: kill silencioso → toast «Reiniciando cámara…» a **3636 ms** y video revivido.
- **4.4 Burst 100 % nulo con cámara muerta → recuperar** en vez de solo tostear (el editor jamás abría — el final exacto del síntoma).
- **4.5 Ring ZSL capado a 1280 px** (constante `RING_MAX_LONG_SIDE`): con el stream alto de iOS, 8 slots a 1920×1440 ≈ 88 MB mataban la capa de video en WebKit; ahora ≈ 37 MB. `snapshotVideo` intacto (la captura conserva la resolución del track).
- **4.6 Toast honesto:** «La foto de alta resolución no respondió — Se usó el fotograma de vista previa. Las próximas capturas irán directas.» cuando ImageCapture existe pero la foto cayó.

**Verificado:** `tsc` core + app, `eslint`, y E2E headless con cámara falsa y mediciones page-precise: hang de takePhoto → fallback en 5014-5197 ms (≤5500, antes ~16000), 5 toques → 1 solo flujo, watchdog sin falsos positivos en 12 s, recuperación ≤6 s. **Hallazgo adversativo documentado:** un hang flaky del editor en el sandbox PRE-EXISTE en `main` (test A/B 3/6 vs 3/6 — no es regresión del fix). Pendiente: QA iPhone físico (memoria del ring, jetsam).

---

## 0-ter. FIX v5 — Calidad de importación, recorte doble, cámara y UX (rama `fix/ux-editor-camera-v5`)

**Base:** `fix/camera-black-recovery-v4` (v4 aún abierto en el PR #12 al ramificar, como exigen las instrucciones). Documentación completa (plan, decisiones, evidencia E2E): `apps/scanner-lab/docs/fix-ux-v5.md`. 8 puntos, un commit por punto.

**Cambios:**

- **5.1 Importaciones nítidas en el editor** — separación DATO/display: `PreviewEntry.displayUrl` (JPEG ≤2560 q0.92, `makeDisplayUrl` re-encodea siempre) consumida por los `<img>` del editor y la presentación; el DATO (`res.processed` PNG 4032, regla R-10) intacto para rotación/export/OCR/guardado. El guardado reprocesa desde `page.original` con 4032 → **WYSIWYG conservado por construcción**. E2E: PNG 3024×4032 de galería → preview `data:image/jpeg` 1971×2560 (~231 KB).
- **5.2 Fin del «doble recorte»** — con detección viva confiable (corners + score ≥ 0.6), la página NACE con el quad del overlay (`liveRef` fresco al instante del disparo, guarda de aspect ±2 %) y NO se lanza la re-detección full-res que entregaba OTRO recorte. `applyAutoQuad`: micro-salto evitado (`quadDrift` < 2 % de la diagonal no reemplaza).
- **5.3 Arranque rápido de cámara** — `localStorage["escaner-main-camera-v1"]`: la 2ª apertura va DIRECTA a la deviceId cacheada (mismas constraints del preview ideal); fallo → caché borrada + sondeo completo. Sondeos con plazo de 2000 ms (`probeCamera(timeoutMs)`) con cierre de la apertura tardía (sin fugas de cámara). Telemetría `__cameraChoice` ahora distingue `cache: true/false`.
- **5.4 Modo espera (nivel 1)** — sin documento 30 s y sin interacción → `CameraFrameLoop.setIdle(true)`: análisis a **2 fps** (500 ms fijos, sin adaptación), stream INTACTO (el watchdog del v4 vigila el track, que sigue vivo — convivencia por construcción). Pill «Modo espera — toca para reactivar»; sale con toque, corners de nuevo o captura. Nivel 2 (parar stream a los 3 min) deliberadamente fuera (instrucción: opcional; un track parado es indistinguible de muerto para el watchdog).
- **5.5 Flash por captura** — `ScannerSettings.flashMode` ("off"/"auto"/"on", default "off", persistido). Ajustes › Procesamiento (Select) + botón rayo en la barra de cámara (cicla, «A» = Auto, rayo relleno = Encendido). En `captureSmart`: "on" fuerza torch; "auto" decide con la exposición FRESCA de snapA (umbral `AUTO_FLASH_EXPOSURE=0.30`, re-medición en el instante que pedía la instrucción); try/finally retira SOLO el torch que el modo encendió — el manual del usuario nunca se apaga. iOS manual (input nativo) intacto.
- **5.6 Toasts deslizables** — `swipeDirections={["left","right","top"]}` en `<Sonner>` (sonner 2.0.8; «up» se llama `top`). E2E: swipe izquierdo sobre un toast → desaparece.
- **5.7 Presentación navegable** — swipe que SIGUE al dedo: `drag="x"` en el contenedor de página (solo a 1× y >1 página, sin momentum), navega con ≥80 px o fling ≥500 px/s y si no rebota (`dragSnapToOrigin`); el swipe a ciegas del pointerup se retira. Doble toque 1×↔**2×** centrado en el punto. **+ fix de bug preexistente (F-NAV):** el guard `e.target !== e.currentTarget` contaba la IMAGEN como «botón hijo» → NINGÚN toque sobre la foto funcionaba (ni chrome ni doble-toque); ahora solo cuentan controles (`button/a/[role=tab]`). E2E: drag bidireccional + rebote, doble tap 2×↔1× sobre la imagen, teclado, thumbnail sin alternar chrome.
- **5.8 Ajustes sin «Proyecto»** — grupo + `ProjectDownloadRow` + constantes + imports huérfanos eliminados. Ajustes queda: Apariencia, Instalación, Procesamiento, Exportación, Almacenamiento, Acerca de.

**Verificado:** `tsc` core + app, `eslint` (0 errores), E2E headless (import galería → editor nítido JPEG ≤2560, presentación con swipe/doble-tap/teclado, toasts deslizables, Ajustes sin «Proyecto», persistencia de flashMode) con **0 errores de consola**. Pendiente QA físico: 5.2 (detección viva), 5.3 (caché con cámara real, criterio <1,5 s), 5.4 (fps ≈ 2 con `live.fps`), 5.5-auto (torch). `apps/digitalizador-e14`: 0 archivos en el diff.

---

## 0-quater. FIX v6 — iPhone real: cámara, pantalla negra y paneo táctil (rama `fix/ios-safari-v6`)

**Base:** `main` en `cef735c` (v4+v5 fusionados, PR #12 y #14). Documentación completa (plan, decisiones, evidencia E2E): `apps/scanner-lab/docs/fix-ios-safari-v6.md`. 4 puntos, un commit por punto. Reportado en iPhone 17 Pro (iOS 26).

**Cambios:**

- **6.1 ⚠️ Detección POSITIVA de Android (`CAN_TAKEPHOTO`)** — Safari moderno (iOS 17+/26) TAMBIÉN expone `ImageCapture` pero su `takePhoto()` se cuelga: la vieja detección por `typeof ImageCapture` metía a iPhone en el régimen ANDROID (preview 960×540 → auto-captura 0.5 MP, toast «alta resolución no respondió», track congelado → negro). Ahora `IS_ANDROID` (UA) + `CAN_TAKEPHOTO` gobiernan: `IDEAL_PREVIEW_*` 960×540 solo Android / **1920×1440 en iOS** (régimen v3 de vuelta), `canTakePhotoRef` en sus 2 sitios, guard primera-línea en `takePhotoBlob`, `profileActiveSensor` solo con CAN_TAKEPHOTO. Regla E3 intacta; Android exactamente igual.
- **6.2 Watchdog de FRESCURA de frames** — hueco de v4 4.3: un video congelado SIN mutear (post-takePhoto colgado de Safari) pasa `isStreamDead()` pero no entrega frames → negro eterno. Nuevo `lastFrameAtRef` alimentado por bucle **rVFC** (Safari 15.4+/Chrome; fallback `onFrame` del loop) — el watchdog pasa a `isStreamDead() || latido > 4 s`, solo en primer plano (`visibilitychange` resetea el latido y relanza `play()` al volver → sin espurias en background). Misma comprobación en la evaluación post-timeout del disparo.
- **6.3 Paneo táctil iOS** — WebKit solo respeta `touch-action` del ELEMENTO donde nace el toque (Chrome evalúa ancestros): el toque nacía en el `<img>` sin touch-action → `pointercancel` → paneo muerto. `touch-none` en el `<img>` + wrapper del pan de PresentationView y del stage de zoom de EditorView (+ overlays de comparación) y listener nativo `touchmove` no pasivo en el stage de la presentación. Lógica de pointer events INTACTA (verificada correcta).
- **6.4 Presentación progresiva** — `openPresentation` ya no decodifica PNG 4032/JPEG 12 MP dentro de la transición: página sin `displayUrl` pinta YA el thumbnail (placeholder iOS `blur(8px)`+escala, swap suave por transición) y genera la copia en background con **concurrencia 2** (cola simple), sembrando la caché (próxima apertura instantánea). Nuevo tipo runtime `PresentationPage`. Pipeline de guardado intacto.

**Verificado:** `tsc` core + app, `eslint` (0), E2E headless con `getUserMedia`/`enumerateDevices` parcheados (canvas-stream con redibujo ~8 fps → camino REAL de apertura y watchdog ejercitables): UA escritorio pide **1920×1440** y salta el profiler; UA Pixel 7 pide **960×540** con profiler + captura por obturador → editor; congelamiento (clearInterval del redibujo) → «Reiniciando cámara…» a **7,76 s** (≤8 s por construcción) + auto-recuperación + 0 espurias en 12 s; `touch-action:none` computado en img/wrapper/stage; doble-toque 2× + arrastre 60 px sobre la imagen = `translateX(60px)` exacto; placeholder `blur(8px)` capturado (49 muestras, ~1,9 s con toBlob retardado) con swap a display. **0 errores de consola/página.** `apps/digitalizador-e14`: 0 archivos en el diff. Pendiente QA físico: checklist en el doc.

---

## 0-quin. E14 — Score 10 para acta identificada (rama `feat/e14-score-10`)

**Base:** `main` en `d20737e` (PR #16 mergeado). SPEC: `SPEC-e14-score-10-identificada.md` (subida por el dueño). **Un archivo de código: `apps/digitalizador-e14/src/lib/e14/scanner-core-bridge.ts`** (+ este registro). Petición literal del dueño: «¿cómo podemos establecer para subir el score al 10/10, que no se quede en 8?».

**Cambios (2 bloques EXACTOS, mismo archivo del PR #16):**

- **`PISO_IDENTIFICADA`: 8.2 → 10** — una acta identificada AUTO (jerarquía divipol validada + mesa ≤ countTable + tipo de copia + página) puntúa 10/10: la identificación completa ES la evidencia de legibilidad total → el score deja de describir la foto cruda y describe la **CERTEZA de la digitalización** (extensión de la doctrina «el OCR manda» del PR #16). `Math.max(score10, PISO_IDENTIFICADA)` CONSERVADO (piso que nunca reduce — invariante del PR #16).
- **Sin cambios en nada más:** `PISO_CONTRASTE_LEGIBLE` sigue 80 · techos fair 7.9 / poor 6.4 intactos · SUGERIDA/MANUAL sin piso (panel de corrección, score métrico honesto) · `statusDeScore` canónico intocado · UI con formato existente (10.0/10) · PDF export no lee el score.

**Consecuencias de estados:** AUTO → SIEMPRE 10.0/10 ÓPTIMA auto-enviada (dueño 8.5→10, SIM 8.2→10, marco-gris 9.2→10) · SUGERIDA/MANUAL/rechazadas → SIN cambio (sin identificación no hay rescate; JAMÁS un MANUAL muestra 10).

**Verificado:** `bun run lint` 0 · `bunx tsc --noEmit` 0 · build estático 0 · `git diff main...HEAD -- apps/scanner-lab packages` VACÍO · QA navegador 390×844 (AC1-AC6 del SPEC) · bytes verificados con node fs (lección AUD-PR11).

---

## 0-quinquies. FIX v7 — Auto-captura iOS: cero mensajes + máxima calidad del stream (rama `fix/ios-auto-quality-v7`)

**Base:** `main` en `d20737e` (v6 fusionado vía PR #15). Documentación completa (plan, decisiones, evidencia E2E): `apps/scanner-lab/docs/fix-auto-quality-v7.md`. 3 puntos, un commit por punto. Reporte: iPhone 17 Pro + usuarios con Chrome en iPhone (mismo motor WebKit — la detección positiva de Android de v6 ya los clasifica en el régimen iOS; cero browser-sniffing nuevo).

**Cambios (todos en `CameraView.tsx`):**

- **7.1 Toast iOS eliminado** — decisión de producto: el usuario NO quiere mensajes. Fuera el bloque «En iPhone: para máxima calidad dispara manualmente (foto nativa)» y su ref (`rg` → 0). Shutter manual → cámara nativa 12 MP (v6 6.1) y flujo de auto-captura intactos.
- **7.3 Ranking del burst consciente de resolución** — FLAW crítico: el ganador por lapVar PURO dejaba a un frame del ring (1280 px, capado por RAM) ganarle al snapshot full-res del stream. Ahora `SHARPNESS_KEEP_RATIO=0.85`: puerta de nitidez (≥85 % del mejor lapVar) → entre los suficientemente nítidos gana el de MAYOR área; desempate por lapVar. Prerrequisito de 7.2 (sin esto, subir el stream no servía de nada). `F-RES-PRIORITY` intacto (takePhoto despacha sin competir); ring sigue a 1280.
- **7.2 Stream al máximo para auto-captura** — límite físico WebKit: sin takePhoto y sin cámara nativa automática, la calidad de la auto-captura = resolución del stream. Subida progresiva SILENCIOSA vía `applyConstraints({width:{ideal:4032},height:{ideal:3024}})` (E3: jamás exact/min) 2 s tras abrir (`applyStream` con guard `cancelled`; `retryRealCamera` con guard de stream reemplazado) y DIRECTO al activar la auto-captura a mitad de sesión (toolbar + menú). Guards: solo no-Android, solo auto ON, solo track live, skip si ≥3000 px, catch silencioso. Telemetría QA `window.__streamUpgrade`. Android byte a byte igual.

**Verificado:** `tsc` core + app, `eslint` (0), E2E headless (dev efímero :3005, emulación iPhone 14/Pixel 7, `applyConstraints` instrumentado): UA iPhone pide **1920×1440** → a los ~2 s exactamente **1 llamada** `ideal 4032×3024` y `__streamUpgrade.before={1920,1440}`; UA Pixel 7 pide **960×540** con **0 llamadas** a applyConstraints; ranking 8/8 casos sintéticos (1280/100 vs 3840/90 → 4K; vs 3840/80 → 1280; paridad → lapVar); auto-captura E2E con UA iPhone: dispara sola → editor → página creada con **0 toasts** y preview **1050×1145** (= recorte de un frame 1920×1440 — el ranking eligió el full-res, no el ring de 1280). **0 errores de consola.** `apps/digitalizador-e14`: 0 archivos. Pendiente QA físico: checklist en el doc.

---

## 0-sexto. E14 — Rediseño REVISIÓN (ADVERTENCIA) + automatización del flujo de rechazos (rama `feat/e14-rediseno-revision`)

**Base:** `main` en `55a35f8` (PR #17 mergeado — score 10/10 activo). SPEC: `SPEC-e14-rediseno-revision-automatizada.md` (subida por el dueño). Petición literal: «cambiemos el diseño por este [mock ADVERTENCIA] · no envies una captura directamente a revisión humana si tiene un score bajo, pedir que se repita · la idea es automatizar la mayor parte del trabajo · solo me manda a contingencia cuando se repite la foto más de 3 veces».

**Cambios (6 archivos: TopBar / ReviewView / BottomNav / store / scanner-core-bridge §7.2 / types comentarios §7.1):**

- **D1 TopBar dinámica:** título por estado `[● ⚠ 7.8/10 ADVERTENCIA · ROMA CONSULADO]` — score real + palabra por estado (ADVERTENCIA=«ADVERTENCIA» ámbar, enmienda sobre el «MODERADA» de Rev. 1) + título truncado + fallback «REVISIÓN DE ACTA»; pill de conexión intacta.
- **D2:** TarjetaRica de ADVERTENCIA ELIMINADA — la info se redistribuye: score+palabra → TopBar, ubicación → breadcrumb, tipo/MESA/PÁG → chips, razón → banner.
- **D3 chips:** `[TRANSMISIÓN][MESA 001][PÁG 1 DE 2]` (tipo real con acento, MESA canónica sin re-formatear). **D4 banner:** «REVISIÓN REQUERIDA (LEVE DESFOQUE|CONTRASTE|LUMINOSIDAD)» — razón display-only por métrica más baja, gate intacto.
- **D5 toolbar de 3 (solo ADVERTENCIA):** Recortar · Rotar 90° · Pantalla completa (Filtros y Texto salen del mock — los sheets siguen para RECHAZADA/OPTIMA). **D6 CTAs en pila:** verde «✓ CONFIRMAR Y ENVIAR DE TODOS MODOS» (h-13) + outline «REPETIR CAPTURA (FOTO MÁS NÍTIDA)».
- **§7 FLUJO AUTOMATIZADO — maxIntentos 2→4:** SUGERIDA/MANUAL con calidad OK → «repetir-primero» (banner «CLASIFICACIÓN PENDIENTE» + REPETIR CAPTURA, panel OCULTO) hasta agotar; al agotar → CONTINGENCIA (panel + toast «ENVIADA A CONTINGENCIA» + fila historial + VOLVER AL ESCÁNER). score <6.5 → RECHAZADA con SOLO «OBLIGATORIO REPETIR FOTO (INTENTO X DE 4)» (botón manual «⚠ ENVIAR A REVISIÓN HUMANA» ELIMINADO — prohibición 4) y contingencia automática (C4) al intento 4. `evaluarGate` firma nueva con (intento, maxIntentos) en ambos pipelines; el recorte NO consume intento (intacto). El conteo cuenta CAPTURAS: una captura sin intento explícito continúa el ciclo si el acta previa sigue sin resolver (importar/disparo) — AC3/AC4 alcanzables re-importando.
- **D8 badge ACTAS:** pill roja con las contingencias del turno (historial REVISION_HUMANA), oculta en 0, `aria-label="Contingencias pendientes"`.
- **§7.6 higiene:** acción huérfana `enviarRevisionHumana` ELIMINADA (store + interfaz) — `rg` → 0 resultados.

**Intactos:** gate AUTO (OPTIMA 10/10 auto-enviada), tarjeta ILEGIBLE, pill GENERICO, panel de corrección, QuadEditor, recorte-rescate, rotación, OCR, transmisión, historial de envíos, ADVERTENCIA nunca auto-escala.

**Verificado:** `bun run lint` 0 · `bunx tsc --noEmit` 0 · build estático 0 · `git diff main...HEAD -- apps/scanner-lab packages` VACÍO · QA navegador 390×844 (AC1-AC8 del SPEC) · cero errores de consola.

---

## 0-septimo. E14 — Rediseño REVISIÓN Rev. 2 — toolbar unificada de 3 en todos los estados de corrección (rama `feat/e14-rediseno-revision-r2`)

**Base:** `main` en `bcc52bd` (PR #20 — Rev. 1 del rediseño). SPEC: `SPEC-e14-rediseno-revision-automatizada Rev. 2` (confirmación del dueño). Petición literal: «en los score intermedio y bajo toca agregar los botones del editor (recortar, rotar y pantalla completa) por si tal vez se tomó automáticamente o se hizo un recorte mal hecho por el sistema se pueda editar y volver a evaluar».

**Cambios (1 archivo de código: ReviewView.tsx):**

- **D5 Rev. 2 — toolbar UNIFICADA de 3 botones** en TODOS los estados de corrección: ADVERTENCIA, RECHAZADA y EN_REVISION_HUMANA (repetir-primero Y contingencia) → `grid-cols-3` con Recortar · Rotar 90° · Pantalla completa. **Filtros y Texto salen de estos tres estados** (el dueño enumeró exactamente los 3) — los sheets NO se eliminan del app: sobreviven SOLO en OPTIMA-rescate (grid-cols-5 con los 5, EXACTO como estaba).
- **El porqué de fondo (documentado en el código):** RECORTAR es la única acción que RE-EVALÚA — `aplicarRecorte` re-corre pipeline+OCR+clasificación+gate SIN consumir intento (F4/D37) — la cura ante una captura automática o un quad mal detectado por el sistema. En EN_REVISION_HUMANA funciona por construcción (D35: el gate es la foto, no la fuente): un recorte que produce AUTO + score ≥ 8 → pantalla OPTIMA de rescate (D20, ENVIAR A TRANSMISIÓN manual) — escapar de contingencia/reintento con un buen recorte ES la automatización buscada; si sigue sin AUTO → el recorte no consume intento y la fase permanece (intento < max → repetir-primero; intento ≥ max → contingencia). En RECHAZADA igual que siempre (AC6 PR #16: SIGUE RECHAZADA).
- Guards intactos (Recortar: `fotoOriginal`; Rotar/Pantalla: `esReal`/`fotoProcesada`) — idénticos a los que ADVERTENCIA ya tenía.

**Sin cambios (explícito):** gate AUTO (OPTIMA 10/10 auto-enviada + ADVERTENCIA confirmable), tarjeta ILEGIBLE, pill GENERICO, panel de corrección, QuadEditor, recorte-rescate (no consume intento), rotación, OCR, transmisión, historial, CTAs de todos los estados (pila D6 de ADVERTENCIA, solo-repetir §7.4 de RECHAZADA, partido por intento §7.3 de EN_REVISION_HUMANA), badge D8, packages/scanner-lab.

**Verificado:** `bun run lint` 0 · `bunx tsc --noEmit` 0 · build estático 0 · `git diff main...HEAD -- apps/scanner-lab packages` VACÍO · QA navegador 390×844 (AC1-AC8 + AC4b Rev. 2) · cero errores de consola.

---

## 0-octavo. FIX v8 — Pan con zoom en el EDITOR: el iPhone no puede desplazarse (rama `fix/editor-pan-v8`)

**Base:** `main` en `6a99ddf` (PR #19 v7-b fusionado y verificado). Documentación completa (diagnóstico, cambios, evidencia E2E): `apps/scanner-lab/docs/fix-editor-pan-v8.md`. Reporte: en el EDITOR el doble-toque amplía bien pero el pan con zoom es «muy difícil» en iPhone físico; la PresentationView (botón Maximize2) funciona bien. La lógica pointer del editor era correcta (verificado en Chromium táctil: pan 1:1, clamp exacto) — lo que fallaba era la capa de gestos de WebKit, el mismo patrón del 6.3.

**Cambios (ambos en `EditorView.tsx`):**

- **8.1 Listener `touchmove` NO pasivo en el stage de zoom** — WebKit se queda con el gesto (rubber-band residual / heurística de doble-toque) y dispara `pointercancel` a mitad del pan aunque toda la cadena tenga `touch-none`; el listener con `preventDefault` lo mata (idéntico al 6.3 de la presentación, que el usuario confirma funcional en su iPhone). El efecto depende de `[mode]` porque el stage es condicional: se desmonta al entrar en «Ajustar bordes» y remonta al volver — un `useEffect([])` solo adjuntaría la primera vez.
- **8.2 `onPointerLeave` solo para mouse** — iOS dispara `pointerleave` espurios a mitad del pan (recomposite del chip de zoom `AnimatePresence` / capa `will-change`) y el handler `onPointerLeave={onStagePointerUp}` lo interpretaba como fin de gesto, matando el paneo con el dedo aún apoyado. Ahora `if (e.pointerType === "mouse")` — el escritorio conserva el comportamiento, el táctil ya no muere. `onPointerCancel` queda INTACTO (recupera los gestos que WebKit sí cancela).

**NO cambiado (lista dura):** `clampZoomPan` (incluido el tope cuando la página es más angosta que el stage — matemática correcta, no es bug), lógica pointer del stage, swipe F-SWIPE, hold-comparar, doble-toque 1×↔2,5×, pinza, PresentationView COMPLETA (6.2/6.3 intactos), todo v7/v6/v5/v4/v3, `PROCESSED_MAX_LONG_SIDE=4032`, reglas E3, watchdog.

**Verificado:** `tsc` = 0, `eslint` = 0, `git diff main...HEAD | grep -c digitalizador-e14` = 0, E2E Chromium táctil (dev efímero :3005, CDP `Input.dispatchTouchEvent`): doble-toque → `scale(2.5)`; pan 40px→`translateX(−40px)` y 150px→`translateY(150px)` exactos (1:1); clamp en el tope sin saltos; swipe a 1× navega páginas y el vertical no hace nada; tras entrar a «Ajustar bordes» y volver el listener 8.1 re-adjunta (depende de `mode`); 0 errores de consola nuevas. QA físico iPhone CONFIRMADO por el dueño vía Vercel Preview (PR #21).

---

## 0-noveno. E14 — Rediseño ENVIADA al mock del dueño + eliminación del flujo PDF (rama `feat/e14-rediseno-enviada`)

**Base:** `main` en `8eb4434` (PR #17/#20/#21/#22 fusionados). SPEC-e14-rediseno-enviada Rev. 2 — la «spec compañera» que las sesiones de rediseño de REVISIÓN dejaron pendiente («ENVIADA mantiene su mock del zip»). Petición literal del dueño: «vamos a remodelar un poco, cambiemos al diseño que te comparto» + confirmación Rev. 2: «sip elimina el pdf». El SPEC se escribió contra `main@55a35f8`; los bloques se re-localizaron POR CONTENIDO (el archivo cambió con PR #20/#22).

**Cambios (4 archivos de código):**

- **D1 — TopBar dinámica: YA EXISTÍA** — PR #20 la implementó «heredada de SPEC-rediseno-enviada Rev. 2» con la enmienda documentada «ADVERTENCIA» > «MODERADA» (el mock de REVISIÓN manda) y las palabras «REVISIÓN HUMANA»/«ENVIADA CON ADVERTENCIA» (<8). Esta rama NO toca `TopBar.tsx` (se documentan las desviaciones de palabra heredadas).
- **D2 — `ReviewView.tsx`: Pill flotante de ENVIADA ELIMINADA** («✓ score/10 ÓPTIMA • Enviado correctamente») — esa información vive ahora en la TopBar (D1) y en la fila de estado (D5). Pills de OPTIMA/GENERICO y banner EN_REVISION_HUMANA intactos.
- **D3 — Tarjeta héroe limpia y tocable (SOLO ENVIADA):** `<button aria-label="Ver acta a pantalla completa">` → overlay existente; fondo `bg-white p-1.5 border border-line rounded-xl` (la imagen B/N llega al borde, como el papel del mock); SIN brackets (los estados editables los conservan idénticos). Placeholder «FOTO NO DISPONIBLE» conservado.
- **D4 — Chips con MESA:** `[TRANSMISIÓN][MESA 001][PÁG 1 DE 2]` — `acta.ubicacion.mesa` canónica de 3 dígitos del pipeline (NO re-formateada), tipo real con acento.
- **D5 — Fila de estado dedicada** (`data-testid="fila-estado"`, justify-between): `✓ ENVIADO AUTOMÁTICAMENTE` … hora a la derecha (`--:--:--` si es manual) + SHA-256 micro-caption (evidencia de transmisión — no se elimina funcionalidad).
- **D6 — CTA único:** UN botón verde grande «SEGUIR ESCANEANDO» (h-13 = 52px); el branch `if (esReal)` de 2 botones desaparece (con y sin foto).
- **D7 — Flujo de exportación a PDF eliminado de la cadena COMPLETA** (decisión del dueño Rev. 2, «sin código muerto»): botón + selector (ReviewView) → acción `exportarPdfActa` (store) → contrato y método del `CompositeBridge` (bridge, con comentarios de cabecera actualizados) → import `pdf-export` + método real (scanner-core-bridge). `packages/scanner-core/pdf-export` INTACTO (scanner-lab lo usa — regla de oro). **Nota de higiene:** los specifiers `excellentQuality`/`makeQuality`/`ScanDocument`/`nombreExportacion` tenían sus ÚNICOS usos dentro del método eliminado → también se retiran de los imports (el §7.7 del SPEC asumía que «se quedan»; verificado con rg — `defaultQuad`/`PageFilter`/`PageQuality`/`Quad` sí se conservan con usos reales). `clasificador.ts` INTACTO (comentario histórico — actualización OPCIONAL per SPEC, no aplicada).

**NO cambiado:** BottomNav, Breadcrumb, overlay de pantalla completa (visorAbierto — existente, funciona para cualquier estado), QuadEditor, PanelClasificación, toolbar unificada de 3 (PR #22) y toolbar de 5 de OPTIMA-rescate, tarjeta ILEGIBLE, toasts, seed, `types.ts`, transmisión al 100 % (`enviarActa`, cola offline, SHA-256 — el PDF NUNCA fue parte del payload: solo alimentaba una descarga local), `apps/scanner-lab` y `packages/` (diff VACÍO).

**Verificado:** `bun run lint` EXIT=0 · `bunx tsc --noEmit` EXIT=0 · build estático `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/web-scanner` EXIT=0 (3/3 páginas) · `git diff main...HEAD -- apps/scanner-lab packages` VACÍO · vaciado `rg "exportarPdf|exportarPdfActa|buildDocPdf|EXPORTAR PDF" apps/digitalizador-e14/src` = **0** · `rg "pdf-export" apps/scanner-lab/src` = 2 (EditorView, LibraryView — el módulo vive) · bundle: «SEGUIR ESCANEANDO»/«Ver acta a pantalla completa»/«fila-estado» presentes, «EXPORTAR PDF»/«PDF GENERADO» ausentes, piso score-10 intacto (`identificada&&(r=Math.max(r,10))`) · QA navegador 390×844 (AC1-AC8) — ver worklog del repo.

## 0-noveno-bis. FIX v9 — Auto-captura invariante al FPS del dispositivo (rama `fix/auto-shutter-fps-v9`)

**Base:** `main` en `8eb4434` (PR #21 v8 fusionado y con QA físico confirmado). Reporte de campo: en dispositivos con video muy fluido la auto-captura NUNCA dispara, como si la app creyera que el usuario «se mueve muy rápido»; en equipos medios funciona normal.

**Causa raíz:** `shouldTriggerShutter` mezclaba «número de muestras» con «tiempo». La compuerta F-STAB vieja exigía que las últimas 6 muestras ocuparan ≥ 260 ms — pero a 30 fps de análisis (throttle adaptativo F-PERF SUBE los fps en equipos rápidos) 6 muestras = 200 ms < 260 → **bloqueado SIEMPRE**. La velocidad de llegada de las muestras depende del FPS del dispositivo, NO de la velocidad del usuario.

**Cambios:**

- **9.1 `quality.ts` — `computeShutterDecision` (exportada) + `shouldTriggerShutter` como wrapper** (misma firma, no rompe consumidores). Decisión en TIEMPO puro + proporción: última buena → ventana temporal completa de 1200 ms (sin `slice(-6)`) → K dinámico `max(2, ceil(windowSamples × 0.7))` → F-STAB v9 = tramo CONTINUO bueno hacia atrás con tolerancia de hueco `max(1.6 × intervaloMedio, 350)` ms → sostenimiento `SHUTTER_SUSTAIN_MS` 260 → **400 ms**. Intactos: `SHUTTER_SCORE=0.8`, `SHUTTER_SPAN_MS=1200`, `CAPTURE_COOLDOWN_MS`, `NO_DETECT_TIMEOUT_MS`, `STABILITY_*`. Eliminadas `SHUTTER_K`/`SHUTTER_N` (0 referencias).
- **9.2 `frame-loop.ts` — `MAX_HISTORY` 24 → 36** (a 30 fps el tramo continuo de 400 ms quedaba recortado con 24 entradas) + campo público `lastShutterHealth` computado ANTES de `emit` y CONGELADO durante el rearm post-captura (la telemetría refleja el frame que DISPARÓ, no los frames residuales con historial vacío).
- **9.3 `CameraView.tsx` — telemetría QA silenciosa** `window.__lastShutter` (`{fpsEff, windowSamples, kRequired, goodInWindow, sustainedGoodMs, triggered, reason}`), mismo patrón que `__cameraTelemetry`. Sin UI.

**NO cambiado (lista dura):** `apps/digitalizador-e14/` (0 archivos), `EditorView.tsx`, `PresentationView.tsx`, `detection-worker.js`, calidad de guardado (`PROCESSED_MAX_LONG_SIDE=4032`, `sensor-profiler`, `dispatchBestFrame`, `upgradeStreamResolution`, `IDEAL_PREVIEW_*`), reglas E3, watchdog, F-ZSL.

**Verificado:** tabla unitaria U1–U8 en Node (bun) con historiales sintéticos — 9/9 PASS: U1 30fps estable dispara (antes bloqueado), U4 gama baja 3fps dispara con K dinámico=3 (bug latente corregido), **U5 barrido rápido SIGUE bloqueado (`sustain`, 165 ms < 400) — regresión crítica cubierta**, U6 `last-bad`, U7 intercaladas no dispara, U8 pico de ruido aislado tolerado (550 ms ≥ 400). E2E sandbox (Playwright + emulación iPhone 14, escena sintética de documento estable vía override de getUserMedia con canvas 1440×1920 @ 30 fps): **CPU 1× dispara** (`fpsEff` 12.3–14.7 — tope del pipeline F-PERF 65 ms ≈ 15 fps, `sustainedGoodMs` 459, editor con página añadida, 0 errores) y **CPU 6× también dispara** (`fpsEff` 2.43, `windowSamples` 3, K dinámico 3, `sustainedGoodMs` 964, editor, 0 errores) — invarianza al FPS demostrada de 2.4 a ~15 fps de análisis. `tsc --noEmit` = 0 en `scanner-core` y `scanner-lab`; `eslint` = 0. Diff limitado a `quality.ts`, `frame-loop.ts`, `CameraView.tsx` (solo telemetría) + este CHANGES.md.

## 0-decimo. FIX v10 — Calidad de vista del EDITOR adaptativa + chip «Se guardará…» eliminado (rama `fix/editor-display-quality-v10`)

**Base:** `main` en `8eb4434` (PR #21 v8 fusionado). Reporte del propietario: «En pantalla completa se ve de mejor calidad que en el editor, ¿por qué?». Causa confirmada en código: la presentación consume `page.processed`/`page.original` (PNG hasta **4032 px**, dato completo) mientras el editor usa `preview.displayUrl` (FIX v5 5.1: JPEG ≤ **2560** px) — al hacer zoom 2.5× el editor queda con ~1024 px efectivos vs ~2016 de la presentación, más los artefactos del re-encode JPEG. **El dato de guardado SIEMPRE fue 4032 y permanece intacto** — solo mejora lo que se VE en pantalla.

**Cambios:**

- **10-A `EditorView.tsx` — tope de DISPLAY adaptativo por dispositivo**: `DISPLAY_MAX_LONG_SIDE` pasa de constante fija 2560 a `computeDisplayMaxLongSide()` computada al cargar el módulo: `deviceMemory ≥ 6` → **4032** (flagship/desktop, nitidez total) · `≥ 3` → **3200** (gama media) · `< 3` → **2560** (gama baja: protección RAM v5 intacta) · sin `deviceMemory` (iOS/Safari) → **3200** (equilibrio). `makeDisplayUrl` NO se toca (ya usa `Math.min(1, …)`; con fuente 4032 y tope 4032 el scale queda 1); `DISPLAY_JPEG_QUALITY` sigue 0.92. Telemetría QA silenciosa `window.__displayMax`. Memoria por imagen activa decodificada: 2560→~19 MB · 3200→~33 MB · 4032→~49 MB (1 activa a la vez).
- **10-B `EditorView.tsx` — chip «Se guardará…» y su drawer ELIMINADOS** (−100 líneas): el chip sobre los botones principales (botón `aria-label="Calidad de guardado del PDF"`), el Sheet de calidad completo, el estado `qualitySheetOpen` y `exportQualityLabel`. Imports compartidos conservados (`DrawerPrimitive` filtros, `ChevronDown` carrusel, `Check` Guardar PDF); el selector `exportQuality` se conserva (lo consume `handleSave` → `buildDocPdf`). Resultado: sin elemento visual encima de «Guardar PDF».
- **10-B `page-store.ts` — migración extendida**: la one-time existente subía solo `"alta"` → `"máxima"`; ahora cubre **TODO valor no-máximo** (`if (parsed.exportQuality !== "máxima") merged.exportQuality = "máxima"`) — p. ej. `"standard"` persistido por usuarios del drawer ya inexistente. Tras la pasada el valor persistido vuelve a ser sagrado (Ajustes › Exportación sigue ofreciendo el selector).

**NO cambiado (lista dura):** `apps/digitalizador-e14/` (0 archivos), calidad de GUARDADO (`page.processed`/`page.url` PNG 4032, `PROCESSED_MAX_LONG_SIDE`, `sensor-profiler`, `buildDocPdf` — solo cambia el VALOR de display, jamás el dato), `PresentationView`, `CameraView`, worker de detección, todo v8/v7/v6/v5/v4/v3.

**Verificado:** `tsc --noEmit` = 0 (core y lab) · `eslint` = 0. Unitario migración (bun, localStorage simulado): **7/7 PASS** — standard→máxima, alta→máxima, máxima intacta, sagrado tras 1ª pasada, instalación nueva default, región OCR v6.1 intacta. E2E sandbox (Playwright): **desktop deviceMemory 8 → `__displayMax=4032`** e import de página de prueba 4032×3024 → `<img>` del editor con `naturalWidth=4032` (display a resolución completa) · **iPhone UA sin deviceMemory → 3200** · **deviceMemory 2 → 2560** · chip y drawer ausentes del DOM (por aria-label y por texto) · «Guardar PDF» crea el documento con normalidad · Ajustes › Calidad PDF muestra **Máxima** tras migrar settings persistidos en `standard` · 0 errores de consola (el 404 de `qa/test-doc.jpg` es la sonda preexistente del SyntheticCamera en dev). Zoom 2.5× con nitidez comparable a la presentación: pendiente de QA físico por Vercel Preview. Diff limitado a `EditorView.tsx`, `page-store.ts` + este CHANGES.md.

---

## 0-undecimo. EXPERIMENTO v11 — Crash-test fuente única, SIN red de seguridad (rama `fix/crash-test-fuente-unica-v11`)

**Base:** `fix/editor-display-quality-v10` en `4f285f1` (PR #25 v10, apilado). Documentación completa: `apps/scanner-lab/docs/fix-crash-test-v11.md`. **Pregunta del experimento:** ¿un dispositivo gama baja crashea si TODO (editor, presentación, zoom) consume el dato completo (PNG ≤4032) sin ninguna copia de pantalla, sin degradación por tier y sin red de seguridad? Decisión del dueño: mientras dure el experimento, **todos los dispositivos ven el mismo dato** (el de 4032). Si no crashea → permanente (más simple, mejor calidad percibida) y las fases de degradación del plan v8 se archivan; si crashea → protección SOLO en el punto exacto. La «red de seguridad» era la copia de pantalla `displayUrl` (JPEG re-encodeado, v5 5.1) — la única protección de datos activa. Beneficio inmediato: editor y presentación consumen exactamente la misma fuente → imposible que se vean distintas (la queja «el editor se ve peor que pantalla completa» desaparece por construcción). SUSTITUYE a v10-C (HIFI condicional por tier): fuente única incondicional, sin `deviceMemory`.

**Cambios:**

- **11.1+11.2 `EditorView.tsx` — generación de `displayUrl` APAGADA (commit `cbd166e`):** G1 lazy-fill eliminado (la entrada sembrada/rotada se pinta YA con su url completa) · G2 build inicial sin re-encode (entry solo con `url/w/h/engine`) · G3 cola de presentación (concurrencia 2, que SE MANTIENE) con swap directo al dato, sin siembra en caché · `computeDisplayMaxLongSide()` → `return 4032` incondicional (tiers v10-A aparcados) → `window.__displayMax === 4032` en todos los dispositivos · `makeDisplayUrl` y `PreviewEntry.displayUrl` NO borrados (seam de reversión con un commit) con contador de verificación `window.__displayUrlCalls` (debe quedar en 0 — prueba de que la red de seguridad no corre).
- **11.3+11.4 `EditorView.tsx` — fuente única (commit `36b5eac`):** C1 editor `src={preview.displayUrl ?? preview.url}` → `src={preview.url}` (zoom/pan del PR #21 intacto) · C2 presentación `entry?.displayUrl ?? null` → `entry?.url ?? null` (si la entry existe arranca YA con el dato; si no, placeholder thumbnail + swap v6.4 intacto, sin re-encode) · telemetría `window.__editorSource = "preview-url"`.
- **11.5 `lib/crash-reporter.ts` NUEVO + `page.tsx` (SOLO observación — NO es red de seguridad):** `installCrashReporter()` idempotente escucha `error` + `unhandledrejection`; PROHIBIDO y ausente: preventDefault/stopPropagation/reintentos/resets/fetch/interceptar console. Registro `{ts, type, message ≤300, source/line/col, stack ≤2000, view, ua, deviceMemory, hardwareConcurrency, heapMB}` → anillo `localStorage["scannerlab_crash_ring"]` (máx 10) + `window.__crashLog`. Banner fijo arriba (equivalente `fixed top-0 inset-x-0 z-[9999] bg-red-900`, estilos INLINE para pintar incluso sin CSS) «⛔ ERROR CAPTURADO — toma captura de pantalla» + botón Cerrar que solo oculta; un banner a la vez. Instalación module-level en `page.tsx` + `window.__scannerView` sincronizado con la vista activa.

**NO cambiado (lista dura):** `apps/digitalizador-e14/` (0 archivos), `PROCESSED_MAX_LONG_SIDE=4032` y exportación SIEMPRE máxima (v10-B intacto: chip eliminado + migración), pan del editor (PR #21: gestos, `touch-none`, doble-tap), reglas E3, recuperación de stream v4/v6/v7 (watchdog, `recoverStream`, latido rVFC), LRU de `previewCache` en 6 (NO reducida — medir la presión real ES el experimento), miniaturas ~160 px, fallback `frame-loop` solo bajo `__scene` QA. **⛔ APARCADO:** plan v8 Fases 0/1/3/4 (la Fase 2 = v9 vive en su PR #23).

**Verificado:** `tsc --noEmit` = 0 · `eslint` = 0 · sin `next build` · `grep displayUrl` → solo tipo + `makeDisplayUrl` (sin llamadas activas) + comentarios «EXPERIMENTO v11»; **cero** lecturas `preview.displayUrl ??`/`entry?.displayUrl ??` · diff limitado a `apps/scanner-lab` (EditorView.tsx, page.tsx, crash-reporter.ts nuevo, CHANGES.md, docs/fix-crash-test-v11.md). Telemetría en 3 entornos + banner TEST-CRASH + escenarios A–D del crash-test: pendientes de QA físico por Vercel Preview (PR ABIERTO SIN FUSIONAR).

---

## 0-decimotercero. FIX v13 — Compatibilidad de dispositivos: perfil de hardware, memoria, CSS resistente y degradación elegante (rama `fix/compatibilidad-dispositivos-v13`)

**Base:** `main` en `255db2d` (tip de la spec). Documentación completa (matriz navegador×capacidad, hallazgos A–F, propuestas IndexedDB/MotionConfig, riesgos de conflicto con v12, evidencia E2E): `apps/scanner-lab/docs/compatibilidad-v13.md`. **PR ABIERTO SIN FUSIONAR** — QA físico primero, merge y rebase los decide el dueño.

**Cambios (7 puntos = 8 commits):**

- **13.1 `lib/device-profile.ts` NUEVO + `crash-reporter.ts` (aditivo):** perfil de hardware en runtime — señales (cores, deviceMemory, UA parseado plataforma+versión mayor, dpr, maxTouchPoints, isSecureContext, matchMedia), micro-benchmark decode+draw 256 px una vez por sesión en idle (`requestIdleCallback` → fallback 1500 ms, try/catch silencioso), tier `bajo/medio/alto` (cores ≤4 O memoria ≤2 GB O bench >8 ms → bajo; cores ≤6 O bench 3–8 ms → medio; en iOS el benchmark manda), cache `localStorage["scannerlab.deviceProfile.v1"]` TTL 24 h y telemetría `window.__deviceProfile = {tier, cores, memoryGB, ua, dpr, touch, benchMs, ts}`. Campo `tier` aditivo en los registros del crash-reporter + meta del banner. Init al importar (vía crash-reporter, ya llamado module-level en page.tsx) — **page.tsx sin toques para el init**. ⛔ El tier NO cambia captura ni análisis (territorio v12).
- **13.2 `globals.css` + 1 línea de `page.tsx`:** bloque estándar `@media (prefers-reduced-motion: reduce)` (animaciones/transiciones 0.01 ms, `scroll-behavior: auto`) · `@supports not (height: 100dvh)` con fallbacks `.h-dvh`/`.min-h-dvh` → `vh` y `.app-frame-h` (clase semántica nueva que sustituye `sm:h-[min(880px,94dvh)]` con el MISMO valor + fallback; media query ≥640 px interna; fuera de `@layer` para ganar el cascade) · 6 targets táctiles subidos a 44 px iOS HIG (X y ⋮ de cámara, compartir/presentación del editor, botones del banner, back del editor).
- **13.3 Higiene de memoria (VERIFICADA):** ambos `revokeObjectURL` **ya existían en main** (image-processor en `finally` tras decode; pdf-export timeout 4 s post-click) — barrido del repo: 0 sitios sin revoke. Comentarios de invariante anti-regresión en ambos sitios. OBSERVACIÓN: el hueco A de la spec estaba ya resuelto (contradicción interna — regla 6 lo insinuaba). **Sin IndexedDB en este PR** — propuesta completa de persistencia de sesión en el informe §4.1.
- **13.4 `lib/webview.ts` NUEVO + CameraView (zona copy):** `isSocialWebView(ua)` (FBAV|FBAN|FB_IAB|FBMD|Instagram|BytedanceWebview|TikTok|Line|LinkedIn|Snapchat|musical_ly — esta última fuera del `\b` porque el guion bajo rompe el word-boundary) · aviso de cámara por **causa real** (`denied/notfound/notreadable/webview/insecure`, registro observacional del `error.name` en los catch existentes de la cascada) con copy accionable por plataforma («abre el enlace en Safari/Chrome», pasos de permiso iOS/Android) · el reintento explica la causa · fallback de galería siempre visible · banner solo en WebView sin CTA inútil.
- **13.5 `onFilePicked` (líneas UI + guards — excepción v12):** guard >80 MB y archivo vacío con toasts de causa real ANTES de decodificar · pill «Convirtiendo imagen… puede tardar unos segundos» anti-parpadeo (300 ms) que cubre HEIC real, «.jpg» con contenido HEIC y decodificaciones lentas (antes solo sonaba por extensión). **Orden del flujo de datos intacto.**
- **13.6 Auditoría landscape/pantallas chicas + 2 fixes:** 375×667, 320×568, 667×375, 844×390 × {cámara, editor, biblioteca, ajustes} → **0 overflow-x y 0 controles recortados**; targets 44 px en Flash y Captura automática (top bar); touch-action v6 intacto. Observaciones (scroll ~25 px preexistente en landscape ≥640 px; breakpoint `sm:` 640 px en móviles landscape) en el informe §4.3.
- **13.7 Informe + esta sección:** `docs/compatibilidad-v13.md` — matriz navegador×capacidad documentada por API (piso iOS 15.x), grep de APIs modernas (**0 usos**: `.at(`, `Object.hasOwn`, `structuredClone`, `findLast`, `toSorted`, `replaceAll`), hallazgos A–F, no-fixes con propuestas, riesgos de conflicto con v12 y evidencia de verificación.

**NO cambiado (lista dura):** `apps/digitalizador-e14/` (0 archivos) · `PROCESSED_MAX_LONG_SIDE=4032` + export «máxima» + `computeDisplayMaxLongSide()=4032` + `__displayMax` · tiers de display NO restaurados · mecanismos verificados (v9 auto-disparo, E3, E4, ranking v7.3, watchdog v4/v6, fuente única v11, pan PR #21, cascada HEIC — lógica intocada) · zona v12 (prewarm de page.tsx, frame-loop, detector-client, pipeline captura→editor) · sin dependencias nuevas · sin IndexedDB · telemetrías existentes (`__lastShutter`, `__displayMax`, `__displayUrlCalls`, `__editorSource` verificadas; las v12-only no existen en main).

**Verificado:** `tsc --noEmit` core=0/app=0 · `eslint`=0 · sin `next build` · E2E headless: import JPEG → editor (página 1600×2200 exacta en DOM), captura sintética → editor, HEIC 293 KB → editor, multi-HEIC 774 KB → **pill visible a los 2,2 s** → editor a los 13,7 s, 0 bytes y texto-renombrado → toasts limpios, `__crashLog`=0 en toda la sesión · `prefers-reduced-motion: reduce` → flujo completo sin errores · `__deviceProfile` legible con tier coherente · isSocialWebView contra 6 UAs reales · landscape/chicas sin overflow. QA físico (iPhone real + preview de Vercel) — pendiente del dueño (protocolo §5 de la spec).

---

## Resumen de commits

| # | Commit | Título |
|---|--------|--------|
| 1 | `3392064` | fix(cámara): estabilizador de quietud + throttling adaptativo + buffer ZSL anti tap-shock |
| 2 | `2f98475` | feat(cámara): Dual Pipeline — preview ligero + captura full-sensor |
| 3 | `27bb731` | perf(scanner): preview dual-pipeline v2 — 960×540 + fps cap 30, foto intacta vía takePhoto |
| 4 | `b4e1aa2` | feat(sensor): sensor-profiler con tope seguro 4032/3200px por gama |
| 5 | `740f7a2` | fix(scanner): F-TEXT-CLEAN — filtro Texto claro sin ruido amplificado, halos de croma ni unsharp global |

---

## 1. Estabilizador + rendimiento del bucle de frames (gama baja y alta)

**Problema:** el obturador automático se disparaba en ~120–150 ms mientras la mano aún acomodaba el teléfono (falsa detección en gama alta), y el bucle de detección saturaba CPU/GPU en gama baja (stuttering y calentamiento).

**Cambios:**

- **NUEVO `src/lib/scanner/motion-stabilizer.ts`** — clase `MotionStabilizer` sobre `DeviceMotion`:
  - Umbrales: aceleración 1.25 m/s² y rotación 14 °/s.
  - Compuerta de quietud `isDeviceStable(280)`: exige 280 ms de quietud antes de autorizar disparo.
  - Degradación elegante donde no hay sensor (desktop).
- **`src/lib/scanner/quality.ts`** — `shouldTriggerShutter` exige ahora una **ventana sostenida ≥ 260 ms** entre la primera y la última muestra k-de-n; elimina el disparo prematuro.
- **`src/lib/scanner/frame-loop.ts`** — **throttling dinámico adaptativo**: cadencia base 65 ms que se relaja +15 ms al saturar y se recupera −3 ms cuando hay holgura (tope 200 ms); reset en `start()`; el estabilizador se integra y destruye en `stop()`.
- **`src/components/scanner/CameraView.tsx`** — **buffer ZSL (Zero Shutter Lag)** de 8 frames con canvas + laplacian variance + timestamp, alimentado a ~5 Hz con canvas scratch reutilizado (sin stuttering adicional):
  - Captura MANUAL: el ganador por `lapVar` entre 80–450 ms **antes** del tap sustituye a la foto del impacto (anti *tap-shock* — el dedo mueve el teléfono en el instante de disparar).
  - Captura AUTO conserva el flujo foto-first.

**Resultado medido:** captura manual nítida incluso con sacudida de tap; auto-captura estable en gama alta; cadencia adaptativa evita el calentamiento en gama baja.

---

## 2. Dual Pipeline — preview ligero + captura a resolución de sensor

**Problema:** un solo `getUserMedia` servía para todo; subir la resolución del preview para mejorar la foto mataba la fluidéz del visor en gama baja.

**Cambios en `src/components/scanner/CameraView.tsx`:**

- **Pilar 1 — Preview:** constantes `IDEAL_PREVIEW_WIDTH/HEIGHT` (1280×720 en v1, **960×540 + `frameRate: { ideal: 30 }` en v2**) aplicadas en las 3 rutas `getUserMedia` (cascada `facingMode`, apertura por `deviceId`, CTA de reintento). El tope es **suave** (`ideal`): no rechaza cámaras solo-60fps.
- **Pilar 2 — Foto:** `takePhotoBlob` documentado e intacto como vía al sensor físico vía `ImageCapture.takePhoto()` (12–48 MP), con la carrera anti-cuelgue de 8 s ya existente.
- `captureSmart` reestructurado: el ganador ZSL pre-tap pasa a ser el **fallback premium** cuando `takePhoto` no existe o cuelga — compite por `lapVar` en `dispatchBestFrame` con los snapshots del canvas.
- **Bug crítico corregido:** `takeZslFallback` liberaba TODOS los canvases del ring incluido el ganador antes de devolverlo → encode 0×0 fallaba y la captura se perdía. Ahora se libera el ring **excepto** el ganador.

**Por qué bajar el preview no afecta la calidad:** el loop de detección remuestrea siempre a 400 px (análisis OpenCV intacto), y la foto final sale del sensor vía `takePhoto`. El fallback ZSL/snapshot opera a 960 px, suficiente para su rol.

**Resultado:** ~44 % menos píxeles por frame de decodificado (frente a 720p) y hasta la mitad de cadencia en equipos que negociaban 60 fps — más fluidéz y menos calor, con la foto a resolución completa del sensor.

---

## 3. Sensor Profiler — tope de captura por gama (PASO 2 del plan de adaptación)

**Problema:** `takePhoto()` disparaba **sin tope** — en sensores de 48/108 MP devolvía ~12000×9000 y el flujo decodificaba el blob ENTERO (~432 MB RGBA) antes del downscale. Riesgo real de crash de pestaña en gama media/baja.

**Cambios:**

- **NUEVO `src/lib/scanner/sensor-profiler.ts`**:
  - `profileSensor(track)`: lee `ImageCapture.getPhotoCapabilities()` (carrera 2 s, degradación elegante en Safari) → perfil `{nativeW/H, ranges, overCap, safeCapPx}`.
  - Tope por **gama** desde el benchmark real de `device-capability` (4032 px alta / 3200 px media-baja, cache 7 días).
  - `buildCappedPhotoSettings()`: genera `{imageWidth, imageHeight}` preservando aspecto, clamped a min/max/step de la spec; `undefined` si el sensor ya está bajo el tope (captura nativa directa, sin re-escalar).
  - `clampBlobToSafeCap()`: red de seguridad post-decode — solo recarta si el blob excede el tope (JPEG 0.92, `bitmap.close()` disciplinado).
- **Integración en `CameraView.tsx`**: `profileActiveSensor()` en `applyStream` y en el reintento; `takePhotoBlob` intenta `takePhoto(photoSettings)` → reintento sin settings si el hardware los rechaza → `clampBlobToSafeCap`. El blob gigante **jamás se decodifica** (capa 1 en el ISP) o se recarta una sola vez (capa 2). El downscale de `handleCaptureDataUrl` usa el tope por gama (tercera red).

**Resultado en dispositivos reales:** sensor ≤4032 px → foto nativa directa; 48/108 MP → el ISP escala en la captura a 4032 (alta) o 3200 (media/baja); si el hardware ignora el ajuste, el clamp post-decode recorta una vez.

---

## 4. Filtro «Texto claro» (default del producto) — F-TEXT-CLEAN

**Problemas en el pipeline anterior:**
1. División `gainW = ink/grayS` con tope 4 × `APPLY_FACTOR_MAX` 8 amplificaba ruido en sombras.
2. `applyModelAndGainToRgba` clampeaba cada canal RGB por separado → virajes amarillo/magenta.
3. Unsharp global previo (worker OpenCV y fallback) ensuciaba el papel antes del filtro.
4. Parámetros agresivos (0.85 / 1.8 / 0.72 / 0.2).

**Cambios:**

- **`src/lib/scanner/image-modes.ts`**:
  - Constantes estabilizadas `TEXT_CLARO_*`: 0.95 / 1.45 / 0.82 / 0.15.
  - Nueva rama `mode === "text"`: **LUT sigmoidal de 256 entradas** (`textTargetLumaLut` — papel ≥0.82 → smoothstep a blanco; tinta `(v/0.82)^1.45` con rodilla en black point 0.15), **afilado edge-aware** (`edgeAwareSharpenGray`: solo bordes con grad>25 y c<240 — el papel nunca se toca) y **reconstrucción cromática uniforme** (`rebuildRgbaWithChroma`: escala `tgt/luma`, sin clamp por canal).
  - LUT idéntica matemáticamente al `Math.pow` por píxel pero **más rápida** (≈90 ms vs 114 ms en 480k px) y con `opts.textPivot` respetado.
  - **Guardas anti-fosforitos** (`F-TEXT-CLEAN`): fade de croma a neutro para tgt>`TEXT_CHROMA_FADE_START`(200) y tope de amplificación de croma `TEXT_CHROMA_MAX_GAIN`(1.5). La tinta de color queda intacta.
- **`src/lib/scanner/image-processor.ts` + `public/scanner/detection-worker.js`**: el unsharp global se omite en `mode === "text"` en AMBOS motores; la rama `text` del worker está espejada byte a byte con el fallback (verificado con evaluación sandbox del bloque + comparación de 27.648 bytes, 0 diffs).

**Resultado medido (baterías sobre docs sintéticos con ground-truth):**

| Métrica | Pipeline viejo | Pipeline nuevo |
|---|---|---|
| Píxeles fosforitos (croma>20) | 5.421 px | **0 px** |
| Halos de croma (frontera blanco) | 21,03 % | **1,18 %** |
| Bolígrafo azul | aplastado a negro | `rgb(53,67,154)` preservado |
| Sello rojo | aplastado a negro | `rgb(144,34,37)` preservado |
| Fondo (captura real 1800×2420) | — | 97,2 % blanco puro, tinta 0,65 % |

---

## 5. Infra / config

> **Nota de integración (revisión pre-push):** `next.config.ts`, `eslint.config.mjs`
> y `package.json` NO cambiaron en este lote — `output: "standalone"`,
> `images.unoptimized`, `allowedDevOrigins`, los ignores de `public/vendor/` y
> `public/scanner/`, y las dependencias `heic2any`/`jspdf` ya estaban en `main`
> (commit v6 `a000ad9`). No hay delta de infraestructura más allá de lo listado abajo.

- **`.gitignore`**: artefactos de sesión/distribución (`public/**/*.zip`, `/tool-results`, `dev.log`).
- **Eliminado** `public/downloads/web-scanner-repo.zip` (6.5 MB committeado por error; ahora cubierto por el ignore).

## Archivos tocados

```
NUEVOS      src/lib/scanner/motion-stabilizer.ts
NUEVOS      src/lib/scanner/sensor-profiler.ts
NUEVOS      CHANGES.md
MODIFICADOS src/components/scanner/CameraView.tsx
MODIFICADOS src/lib/scanner/quality.ts
MODIFICADOS src/lib/scanner/frame-loop.ts
MODIFICADOS src/lib/scanner/image-modes.ts
MODIFICADOS src/lib/scanner/image-processor.ts
MODIFICADOS public/scanner/detection-worker.js
MODIFICADOS .gitignore
ELIMINADO   public/downloads/web-scanner-repo.zip (artefacto de 6.5 MB)
```

## Cómo validar en local

```bash
bun install
bun run dev        # abrir en móvil (HTTPS requerido para cámara/DeviceMotion)
# Flujo: onboarding → cámara → captura manual (ZSL) / auto (compuertas) → editor (filtros) → PDF
```

## Notas conocidas (preexistentes, fuera de alcance)

- El aplanado de regiones oscuras GRANDES (sello grande lavado a blanco) es comportamiento del modelo de sombras del worker OpenCV, común a ambos pipelines y anterior a estos cambios.
