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

## 0-duodecimo. E14 — Rediseño CHROME 3 ESTADOS + botón «REVISIÓN HUMANA» con candado (rama `feat/e14-chrome-3-estados`)

**Base:** `main` en `255db2d` (PRs #20–#26 fusionados). SPEC-e14-rediseno-chrome-3-estados Rev. 3 — fidelidad a los 3 mocks finales del dueño (score bajo = RECHAZADA · intermedio = ADVERTENCIA · alto = ENVIADA/OPTIMA) + petición literal Rev. 3: «si repetidamente rechaza la imagen se habilita el boton de "revision humana" en score intermedio y bajo» (icono QR persona + llave).

**Cambios (5 archivos de código + este CHANGES.md):**

- **D1 — `TopBar.tsx`:** el título del acta BAJA al banner de ubicación (D2 en ReviewView); la TopBar porta SOLO la pill BORDEADA de estado del mock `[● ▲ 4.2/10 RECHAZADA]` (score/palabra REALES, `role="status"`, campo `tonoBorde` nuevo por rama de `estiloTopBar`). Icono ▲ SOLO en estados warn (`WarnTriangleIcon`, import nuevo); ✓/✕ dejan de renderizarse; subtítulo `<span>E-14</span>` ELIMINADO (ningún mock lo dibuja); fallback `<h1>REVISIÓN DE ACTA</h1>` intacto.
- **D2 — `ReviewView.tsx`:** el Breadcrumb largo y `detalleUbicacion`/`mesa` (sin uso) se ELIMINAN → banner de ubicación ÚNICO para TODOS los estados (el `<h1>` visible cuando hay acta), data-driven: clasificación → dot verde + título REAL (trunca) `text-white`; sin clasificación → dot rojo + «NO IDENTIFICADO» `text-crit`; EN_RH sin clasificación → dot ámbar + «CLASIFICACIÓN PENDIENTE» `text-warn`.
- **D3 — chips ÚNICOS ARRIBA de la tarjeta (todos los estados), data-driven (veto Rev. 2):** una sola fila compartida dentro del `<main>`, inmediatamente antes del visor — el «---» es SOLO el fallback cuando el sistema NO logra identificar (`[---][MESA ---][PÁG - DE -]`); con clasificación → datos reales del acta en cualquier estado (tipo con acento, MESA canónica del pipeline, PÁG real). Chip 1 `solid` con tono por estado (ENVIADA/OPTIMA ok · ADVERTENCIA/EN_RH warn · RECHAZADA crit). Predicado único compartido `hayClasificacion`. Bloques viejos de chips (ENVIADA bajo tarjeta + ADVERTENCIA) eliminados; fila «✓ ENVIADO AUTOMÁTICAMENTE │ hora» + SHA-256 quedan en su lugar (entre tarjeta y CTA).
- **D4 — brackets de color en TODAS las tarjetas:** ENVIADA RECUPERA los brackets verdes del mock 3 — el MISMO overlay de 4 esquinas de la rama no-ENVIADA (w-6 h-6 border-2, `border-ok-tint`, `pointer-events-none z-10`, `aria-hidden`) DENTRO del botón héroe blanco; botón y `onClick` EXACTOS.
- **D5 — `primitives.tsx` `ToolbarBtn` prop `tone?: "crit"`:** «Recortar» ROJO sólido (`bg-crit border-crit text-white`) SOLO en `status === "RECHAZADA"` (mock 1); Rotar/Pantalla completa neutros; icono blanco en tono crit. La toolbar de 5 de OPTIMA-rescate INTACTA.
- **D6 — CTAs al mock:** ADVERTENCIA pierde «✓ CONFIRMAR Y ENVIAR DE TODOS MODOS» (veto Rev. 2) → pila «REPETIR FOTO» (`outline-crit` + RefreshIcon) + «REVISIÓN HUMANA»; RECHAZADA envuelta en la misma pila (primario crítico con «(INTENTO X DE 4)» dinámico); ENVIADA «SEGUIR ESCANEANDO» (sin «MESA», veto Rev. 2) + icono ⊕ (`PlusCircleIcon` nuevo). `enviarActa` INTACTA en el store (auto-envío y rescate OPTIMA la siguen usando).
- **D6-bis — botón «REVISIÓN HUMANA» con candado (ADVERTENCIA + RECHAZADA):** componente local `BtnRevisionHumana` (PrimaryBtn `outline-warn` — variante nueva — + `UserKeyIcon` persona+llave, `ariaLabel`), deshabilitado hasta `acta.intento >= UMBRAL_REVISION_HUMANA` (3, constante de vista module-level retunable); el candado visual (opacidad 40 + `aria-disabled` + onClick anulado) ya lo estila `PrimaryBtn`.
- **§6 bis — `store.ts` acción ADITIVA `escalarRevisionHumana()` (ÚNICA excepción a «0 cambios de lógica», 0 líneas existentes modificadas — 25 adiciones, 0 eliminaciones):** guard ADVERTENCIA/RECHAZADA (resto no-op) → `status EN_REVISION_HUMANA` + `intento = maxIntentos` (cede el ciclo → destino = sabor contingencia EXACTO del camino automático: «VOLVER AL ESCÁNER», sin duplicar contingencia) + fila de historial `REVISION_HUMANA` (badge ACTAS +1 gratis, BottomNav intacto) + toast warn «ENVIADA A CONTINGENCIA» (descripción propia «Un auditor validará esta acta.»). Reutiliza las primitivas del bloque automático (`tituloPaginaActual()`, `bridge.horaHistorial()`, `HistorialRow`, `notificar`). Gate, `dispararEscaneo`, bloque automático de contingencia, `repetirFoto`, `enviarActa`, `aplicarRecorte`: INTACTOS.
- **D7 — tarjeta ILEGIBLE y pill GENERICO ELIMINADAS de ReviewView** (la información ya la dan pill D1 + banner D2 + chips D3 + CTA D6); `TarjetaRica`/`ScoreBadge` sin usos → retiradas. Pill de rescate OPTIMA y banners EN_RH INTACTOS.
- **`icons.tsx`:** NUEVOS `PlusCircleIcon` (círculo con +) + `UserKeyIcon` (busto persona + llave), trazo 2, linecap/linejoin round, patrón SVG inline del archivo.

**NO cambiado:** BottomNav (el badge ACTAS sube SOLO con la fila de historial de la acción nueva), overlay de pantalla completa, QuadEditor, PanelClasificación, toolbar de 5 de OPTIMA-rescate, banners EN_RH, fila estado+SHA-256, pill de conexión, gate/`scanner-core-bridge.ts`/`types.ts`/`clasificador.ts`/`bridge.ts`/seed, `apps/scanner-lab`, `packages/`.

**Verificado:** `bun run lint:e14` EXIT=0 · `bun run e14:check` EXIT=0 · build estático `BUILD_STATIC=1` EXIT=0 (3/3 páginas) · diff limitado a los 6 archivos permitidos (TopBar/ReviewView/primitives/icons/store/CHANGES.md) · `git diff main...HEAD --numstat -- lib/e14/store.ts` = 25 adiciones 0 eliminaciones · `rg "Breadcrumb|detalleUbicacion|CONFIRMAR Y ENVIAR|SEGUIR ESCANEANDO MESA|E-14</span>"` en componentes = **0** («ACTA NO RECONOCIDA» sobrevive SOLO en 2 literales preexistentes PROHIBIDOS de tocar por §11: el título del toast de RECHAZADA de `store.ts` y un comentario de `scanner-core-bridge.ts`) · `rg "escalarRevisionHumana"` = interfaz + acción + selector + 2 usos (ReviewCtas) · `rg "enviarActa"` conserva auto + OPTIMA.

**Post-QA (M17-4, defecto 2 — AC4):** el predicado compartido `hayClasificacion` de ReviewView pasa de `Boolean(acta.clasificacion)` a exigir además `nivel !== "MANUAL"` — el gate adjunta SIEMPRE el objeto clasificación en EN_RH y nivel MANUAL = nada resuelto por el clasificador → cuenta como NO identificada (banner «CLASIFICACIÓN PENDIENTE» ámbar + chips `[---][MESA ---][PÁG - DE -]`); AUTO/SUGERIDA (incl. escalada desde ADVERTENCIA con AUTO) y RECHAZADA (`clasificacion:null`) sin cambio. AC4 (del spec) gana sobre el literal D2/D3.

**Rev. 4 + Rev. 5 (fidelidad al export Stitch del dueño — `stitch_exportaci_n_parcial_stitch`, mismas 6 pantallas del PR):** el dueño marcó «no siguió correctamente el diseño que realice, toca corregir algunas cosas» y cerró los flags con «son diseños, la lógica sigue igual, los datos sí se pueden cambiar». Correcciones SOLO en `ReviewView.tsx` (resto de archivos ya cumplía):
- **DEV-1 — brackets VERDES SIEMPRE:** los 5 HTML del export definen las esquinas con `#00E676` 3.5px en TODOS los estados (incluidas RECHAZADA/ADVERTENCIA) → se ELIMINA la función `tonoBrackets` (coloreo por estado) y los 8 brackets pasan a `border-ok-tint` + `border-[3.5px]` fijos; de paso se corrige el bracket inferior-derecho que usaba `border-l` en vez de `border-r` (bug visual preexistente de Rev. 3, visible en ambas tarjetas).
- **DEV-2 — candado POR AUSENCIA:** adv_1/rechazada_1 (intento 1) NO dibujan «REVISIÓN HUMANA»; adv_2 lo muestra ya activo → el botón NO se monta en el DOM hasta `puedeEscalar` (`intento >= 3`); FUERA el visible-deshabilitado (`disabled`/`aria-disabled`/opacidad). `BtnRevisionHumana` pierde la prop `puedeEscalar`.
- **DEV-3 — CTAs LADO A LADO al abrirse el candado:** ADVERTENCIA y RECHAZADA desbloqueadas pasan a `grid grid-cols-2 gap-2` (ámbar+ámbar según adv_2; crítico+ámbar en RECHAZADA — el export rechazada_2 confirma las 2 columnas). El label largo «OBLIGATORIO REPETIR FOTO (INTENTO X DE 4)» envuelve a 2 líneas en half-width (`leading-tight` ya en PrimaryBtn).
- **DEV-4 — «REPETIR FOTO» de ADVERTENCIA es ÁMBAR outline, no rojo:** `outline-crit` → `outline-warn` (adv_1/adv_2: `border-amber-500/80 text-amber-400`). `rg "outline-crit" ReviewView.tsx` → 0.
- **D3 Rev. 5 — chip PÁG data-driven (decisión 4):** `PÁG {idx} DE {total}` SIEMPRE que el pipeline adjuntó clasificación (AUTO/SUGERIDA/MANUAL — p. ej. el EN_RH de sin-anclas muestra «PÁG 1 DE 2»); «PÁG - DE -» SOLO si la página no se pudo identificar (RECHAZADA sin clasificación). Predicado nuevo `paginaIdentificada = acta.clasificacion != null` — distinto del de chips 1/2 (`hayClasificacion`, que exige nivel ≠ MANUAL) porque la paginación del ciclo se conoce aunque nada esté resuelto.
- **Ruido de Stitch NO replicado (decisión 11):** badge azul `bg-blue-600/80` + `animate-spin` dentro del CTA de RECHAZADA. Icono del botón RH: se mantiene `UserKeyIcon` (persona+llave — referencia QR EXPLÍCITA del dueño) aunque el export dibuja 👤 simple.
- Sin cambios de lógica: store/gate/bridge intactos (la acción `escalarRevisionHumana` de §6 bis ya estaba); ENVIADA/OPTIMA/EN_RH/EN_RH-contingencia sin cambios de CTA; BottomNav/overlay/panel INTACTOS.

---

## 0-decimotercio. E14 — REDISEÑO «CYBER-NEÓN» del chrome (rama `feat/e14-rediseno-cyber-neon`, base PR #28 @ `d87f8ce`)

**Base:** head del PR #28 (chrome-3-estados Rev. 4+5). SPEC-e14-cyber-neon Rev. 1 — supersede VISUAL del chrome con mandato literal del dueño: «imagina ahora que no tenemos nada de diseño en el proyecto, y que tenemos que seguir IGUAL el diseño de la imagen, esto prohibido y nos regañan si no queda igual». Mock único 260×588 (ENVIADA, pills neón); la LÓGICA sigue intacta (decisión cerrada Rev. 5: «son diseños, la parte lógica sigue igual, los datos sí se pueden cambiar») — valores data-driven, forma 1:1 al mock.

**Cambios (7 archivos de código + manifest + este CHANGES.md):**

- **§2 — `globals.css` tokens + glows:** paleta medida por píxeles del mock, TODA la app hereda: `bg #060A0D` (negro azulado casi total), `surface-1/2/3 → #11181E/#16222E/#1A242E`, NUEVOS `surface-card #0B1116` (contenedor del acta) y `nav-bg #0E1319`; `ok-tint → #0BF282` (verde neón — chips activos, brackets, iconos, textos de estado); NUEVOS `neon-strong #03DF73` (relleno CTA), `neon-ink #000`, `green-bar/-border/-inset`, `ring-dim`; `ink → #FFFFFF`, `ink-dim → #8A94A3`. Warn `#ffd600` y crit `#ff5252` SIN cambio. 9 utilidades glow nuevas por tono (ok/crit/ámbar): `glow-sm` (box 10px+2px), `glow-md` (drop-shadow 5px — brackets y checks), `glow-cta` (box 12/32px+3/10px).
- **§3 — `TopBar.tsx`:** pill de estado = cápsula `h-[34px] px-3.5 rounded-full bg-surface-1` con anillo del tono (borde 35% + glow-sm, campo `glow` nuevo en `estiloTopBar`); punto SÓLIDO 12px SIN animar (fuera `animate-pulse-sync` y el ▲ de warn — estructura del mock: punto + score + palabra); score y palabra en DOS spans (13px bold tracking 0.08em mono; score neón, palabra blanca). Botón derecho = cápsula `h-[34px] px-3` con anillo verde/ámbar por conexión + nube `w-[18px]` + punto 1.5px (función de alternar conexión INTACTA). Header sin borde/backdrop (funde con la página). Flecha «←» strokeWidth 2.5 (`ArrowLeftIcon`).
- **§4 — banner de ubicación (ReviewView):** cáscara `h-[42px] rounded-full bg-surface-2 px-4` con punto 10px y texto BLANCO bold tracking 0.12em (trunca, dato real — el tono del texto sale; punto por identificación, borde+glow por estado §10). `textoUbicacion` eliminado.
- **§5 — chips (ReviewView + `primitives.tsx`):** fila centrada `justify-center gap-2.5`; Chip = cápsula `h-[34px] px-4` mono bold 11px tracking 0.14em — sólido: relleno del tono + texto NEGRO + glow-sm (TRANSMISIÓN neón; crit/ámbar por estado §10); inactivo: navy `surface-3` + texto blanco + `border-white/6`. Data-driven Rev. 5 intacto (fallbacks `---`/`MESA ---`/`PÁG - DE -` solo sin identificación).
- **§6 — tarjeta del acta (ReviewView, ambos estados):** el acta vive DENTRO de un CONTENEDOR OSCURO `rounded-[20px] bg-surface-card p-[10px]`; brackets = 8 BARRAS `bg-ok-tint` 3.5px × 34px `rounded-[2px]` con `glow-md` (drop-shadow del grupo) sobre las esquinas DEL CONTENEDOR (componente `BracketsNeon` — reemplaza los corners-border de Rev. 4; el fix border-r queda subsumido en barras simétricas); acta blanca `rounded-[14px] object-cover` (esquinas propias, separada 10px del contenedor). Botón héroe ENVIADA (tap → pantalla completa) y `<section>` de corrección con la MISMA geometría.
- **§7 — barra de envío (ENVIADA, ReviewView):** contenedor NUEVO `h-[46px] rounded-full bg-green-bar border-green-bar-border px-3.5` + check en círculo neón sólido 28px (`glow-md`, palomita negra `strokeWidth 3` — `CheckIcon` gana prop `strokeWidth`) + `ENVIADO AUTOMÁTICAMENTE/CORRECTAMENTE` neón 11.5px + hora en recuadro PROPIO `green-inset rounded-[9px]`. **SHA-256 ELIMINADO de la vista** (cambio deliberado del dueño; el hash se sigue calculando en el store para registro — 0 usos display en ReviewView).
- **§10 — extrapolación a los otros estados:** RECHAZADA estrena barra de rechazo (`h-[46px]` cápsula `bg-crit/12 border-crit/30` con ✕ en círculo crit sólido — `XIcon` nuevo; `data-testid="barra-rechazo"`); ADVERTENCIA: su banner de razón («REVISIÓN REQUERIDA (…)») sube a la posición de la barra de estado y se re-viste como cápsula ámbar (`bg-warn/12 border-warn/30`, ▲ en círculo ámbar sólido — dato y testid intactos); chips/pill/banner de warn y crit con el mismo tratamiento sólido+glow. Candado RH (`bg-warn/12 border-warn/40 text-warn glow`), escalación, data-driven y grid-cols-2 INTACTOS.
- **§8 — CTAs:** ENVIADA = pill `h-[52px] rounded-full bg-neon-strong glow-cta` con «+» en círculo NEGRO 28px (`PlusIcon` nuevo) y «SEGUIR/ESCANEANDO» en DOS LÍNEAS (mono extrabold 14px tracking 0.18em texto negro). `PrimaryBtn` (`primitives.tsx`) = cápsula 52px mono extrabold con glow-cta del tono (ok → `neon-strong`+texto negro; crit → glow-cta-crit; outline-warn → `bg-warn/12 border-warn/40 glow-sm-warn`); `ToolbarBtn` = cápsula mono bold uppercase (neutro navy surface-3 + white/6; crit sólido glow). `PlusCircleIcon` sin usos en ReviewView.
- **§9 — `BottomNav.tsx` (reescrito):** barra tipo app nativa `bg-nav-bg` + `border-t white/5`, 78px totales (ítems 70px + home-indicator `130×4 white/20`), `pb-safe`. Ítem activo: icono en ELIPSE `46×40 rounded-[50%] border-2` neón + glow-sm (misma caja en inactivos para alinear labels); ESCANEAR activo también en vista «revision» (el mock ENVIADA anilla ESCANEAR — solo presentación). ACTAS: documento OUTLINE strokeWidth 1.8 (`DocumentNavIcon` re-dibujado) + conteo real «(N)» bajo el label 9px — SUSTITUYE el badge rojo (número data-driven del store). RESUMEN: `GridIcon` NUEVO (cuadrícula 2×2 de 4 cuadritos redondeados 7px, viewBox 17×17). Iconos inactivos #C7CEDA. Slot de CTAs (modo dark) conservado; modo app comparte la MISMA barra (tokens globales).
- **§11 DEV-6 — espaciador condicional en EN_RH** (`h-16` bajo el banner flotante) para que los chips queden visibles (repetir-primero y contingencia). `FloatingBanner.tsx` sin cambios (los toasts heredan tokens).
- **§12 PWA:** `public/manifest.webmanifest` NUEVO (`display: standalone`, `background_color`/`theme_color` `#060A0D`, nombre «Digitalizador E-14») + `layout.tsx`: `manifest` en metadata (Next prefija basePath al servir) y `themeColor → #060A0D`. SIN service worker ni install-prompt (fuera de alcance).

**NO cambiado:** `store.ts`/`types.ts`/`clasificador.ts`/`bridge.ts`/`scanner-core-bridge.ts` (gate, `dispararEscaneo`, bloque contingencia L383-397, `repetirFoto`, `enviarActa`, `aplicarRecorte`, `escalarRevisionHumana`, UMBRAL 3), `page.tsx`, QuadEditor, PanelClasificación (hereda PrimaryBtn), sheets OCR/filtros, overlay pantalla completa, pill de rescate OPTIMA y banners flotantes EN_RH, `apps/scanner-lab`, `packages/`.

**Verificado:** `bun run lint:e14` EXIT=0 · `bun run e14:check` (tsc) EXIT=0 · build estático `BUILD_STATIC=1` EXIT=0 (3/3 páginas) · diff confinado a §1 (7 archivos permitidos + manifest + CHANGES; `git diff -- apps/scanner-lab packages` = 0 líneas; `src/lib` = 0 líneas) · bundle CSS: tokens neón presentes (`#060a0d`/`#0e1319`/`#0bf282`×21/`#03df73`/green-bar triplete), 9 utilidades glow compiladas, radios 20/14/9/50%/9999 y barras 3.5px+34px · strings del chrome nuevo en el chunk de revisión («ACTA RECHAZADA», «barra-rechazo», «fila-estado», «SEGUIR»+«ESCANEANDO», «banner-revision») · SHA-256: 0 usos display en ReviewView (los 2 únicos hits del bundle = cálculo crypto del store + «HASH SHA-256 EN COLA» de ANALIZANDO, preexistente). Los 2 hits de «SHA-256» y 1 de «pulse» en ReviewView/TopBar son COMENTARIOS (los elimina el compilador — no llegan al DOM).

**Post-QA (M19-1/M19-1-bis, navegador sobre build local 390×844/360×740):** AC2-AC12 ALL PASS (computed styles token por token + comparación visual 1:1 contra el mock con VLM + 0 errores de consola + escalación manual/auto E2E + contingencia del 4º rechazo intacta). Defecto menor AC11 corregido en `dea7b02`: el espaciador DEV-6 pasa de fijo 64px a CONDICIONAL 76px (banner repetir-primero de 2 líneas, 69px) / 64px (contingencia, 54px) — re-verificado con bounding boxes y elementFromPoint: holgura 8-11px, 0 solape en ambos estados EN_RH. Ajuste de precisión: grid del nav h-[73px] → barra computada 78px exactos (§9).

**Post-Merge (M20):** PR #30 mergeado con autorización del dueño («Mergea con confianza») — sha candado `a732465` + `merge_method=merge` → commit de fusión `e32410f`; el PR #28 (chrome-3-estados, apilado) quedó cubierto y GitHub lo auto-cerró como mergeado. Gates re-ejecutados 3/3 sobre `a732465` justo antes de fusionar. CI «Deploy to GitHub Pages» en `e32410f`: completed/success. Producción verificada por fingerprint de bundle: `/` 200 · `/lab/` 200 · `manifest.webmanifest` 404→200 (`standalone`, `#060A0D`) · chunk nuevo de la app `2-cbxog0vc8w-.js` con `glow-cta`×4, «ACTA RECHAZADA», «barra-rechazo» · CSS nuevo `38-slc8n25d2z.css` con los 6 tokens hex medidos (`#060a0d`×4, `#0e1319`, `#0bf282`×21, `#03df73`, `#0b1116`, `#11251c`) + 3 clases glow · inversión confirmada: chunk viejo `3rpo1-odiwwpp.js` 404 y CSS viejo `1sy_xatcppy4h.css` 404 · «SHA-256: » display 0 · «SEGUIR»+«ESCANEANDO», «REPETIR FOTO»×5, «REVISIÓN HUMANA»×4 presentes. Rollback: revert de `e32410f` (~2-3 min).

---

## 0-decimocuarto. E14 — REDISEÑO «CYBER-NEÓN» de la PANTALLA DE CÁMARA (rama `feat/e14-rediseno-cyber-neon-captura`, base main@`bb2aa8f`)

**Base:** main con la ronda neón del chrome ya mergeada (PR #30). SPEC-e14-cyber-neon-captura Rev. 1 — re-estiliza la pantalla ESCANEAR (`ScanView.tsx`) 1:1 al mock del dueño 260×588 (visor negro, HUD de cámara pro). Tokens y nav heredados de SPEC-e14-cyber-neon §2/§9. La LÓGICA de cámara queda INTACTA (fallbacks, disparo por plataforma, linterna F-FLASH v3, ZSL, sensor-profiler, rutas iOS): solo capa visual.

**Cambios (3 archivos de código + CHANGES.md):**

- **§2 `globals.css`:** 3 tokens nuevos de HUD: `--visor-bg #030504` (visor negro absoluto cálido), `--amber-hud #E8C84A` (botón HUD superior derecho), `--hud-blue #24357A` (punto azul del pill de modos).
- **§1 `icons.tsx`:** 4 iconos nuevos — `FolderImportIcon` (carpeta con flecha, stroke 1.8), `BoltIcon` (rayo, 1.8), `FocusFrameIcon` (4 brackets de enfoque + punto central), `FileDocIcon` (documento con líneas, 1.8 — el obturador del mock).
- **§3 `ScanView.tsx` — pill de modos (sup. izq.):** cápsula `h-[40px] bg-[#0C1018]/90 border-white/10` con «IA» (chip BLANCO h-28 → SIMULACIÓN), icono cuadrícula (→ IMPORTAR, abre picker), punto azul y «AUTO» (→ CÁMARA). REEMPLAZA la fila de chips de fuente con la MISMA acción de cambio de modo (mismo `setFuente`/`inputRef.click()`, con fallbacks). El chip blanco SIEMPRE es data-driven del store.
- **§4 HUD ámbar + ⋮ (sup. der.):** círculo 44px border-2 ámbar + glow 12px con `FocusFrameIcon` («Modo de enfoque») y botón ⋮ 40×40 — decorativos, sin lógica (opción por defecto de la spec).
- **§5 visor:** full-bleed `bg-visor-bg` ocupando todo el alto entre top bar y fila de estado, LIMPIO en SIMULACIÓN/ARCHIVO (sin corner brackets, sin retícula, sin «ESPERANDO CAPTURA» — la info de modo vive en la fila de estado). En CÁMARA se conservan TODOS los overlays funcionales re-vestidos a tokens neón (cápsulas border-white/10, tipografía bold mono, radios cápsula): INICIANDO, quad SVG + anclajes, BUSCANDO ACTA (reubicada a `top-[72px]` bajo la fila HUD), HUD CALIDAD/DETECTADA/IA·AUTO (posición intacta), MANTÉN INMÓVIL (cápsula), CAPTURANDO y destello.
- **§6 fila de estado:** `h-[24px]` sobre fondo de página — punto `bg-ok-tint` + label del modo ACTIVO data-driven («SIMULACIÓN»/«CÁMARA»/«IMPORTAR») 10px bold tracking 0.14em #C7CEDA; derecha HUD decorativo «ISO: 1600» #666A69 (string canónico de la spec).
- **§7 chips de calidad:** 3 chips `h-[30px] rounded-[10px]` DECORATIVOS (no interactivos) — ÓPTIMA `[8.2]` (tinte 12%/borde 40% de #0bf282), MEDIO `[7.0]` (#ffd600), BAJA `[4.3]` (#ff5252), dot sólido + anillo colgante `w-2.5 h-2.5 border-2` del tono medio solapado (`-mt-[5px]`). Brackets con `aria-hidden`.
- **§8 fila de disparo:** en SIM/ARCHIVO 1:1 al mock `[Importar | obturador | Flash]` gap-52px: carpeta 26px+label (MISMO picker), obturador Ø72 border-2.5 blanco con anillo interior 56px y `FileDocIcon` 30px (MISMO `alDisparar`), rayo 24px+label (div decorativo aria-hidden). En CÁMARA conserva los CONTROLES FUNCIONALES re-vestidos al lenguaje del mock: `[FLASH (linterna real, ámbar cuando torch on) | obturador | AUTO (armado, ok-tint)]`.

**Decisiones interpretativas (documentadas, extrapolación de la spec):** (1) ARCHIVO también visor limpio — la spec elimina la retícula/«ESPERANDO» de SIMULACIÓN; el modo se comunica en fila de estado + botón Importar con label. (2) En CÁMARA la fila de disparo NO es 1:1 al mock (el mock es estado SIMULACIÓN): FLASH conserva la linterna real (F-FLASH v3) y AUTO el armado del gate (D22/D24) — eliminarlos sería regresión funcional; mismos botones columna icono+label. (3) Corner brackets eliminados en TODOS los modos (decorativos, ausentes en el mock; los overlays FUNCIONALES de CÁMARA se conservan íntegros). (4) Panel de simulación inferior ELIMINADO: el toggle online ya vive en el TopBar (mismo `alternarConexion`), la info de modo en la fila de estado, IMPORTAR en la fila de disparo/pill. (5) Pill «BUSCANDO ACTA» baja a top-[72px] para no chocar con la fila HUD flotante. (6) Obturador con glow ok-tint cuando `scoreAlto` en CÁMARA (cue funcional del gate, re-vestido). (7) Pill de modos y HUD flotan SOBRE el visor (spec §5: el visor ocupa «todo el alto entre top bar y fila de estado»).

**NO cambiado:** TODA la lógica de cámara de `ScanView.tsx` (estados, efectos, `probeCamera`/`chooseMainProbe`, ZSL, `capturarInteligente`, `alDisparar` por plataforma, `alElegirArchivo`/`alElegirFotoCamara`, linterna, fallbacks L866-1089 y disparo L1211+ — 0 hunks del diff tocan esos bloques), `store.ts`, `types.ts`, `ReviewView`/`TopBar`/`BottomNav` (neón del PR #30), `apps/scanner-lab`, `packages/`.

**Verificado:** gates 3/3 (`lint:e14` 0 · `e14:check` tsc 0 · build estático 0, 3/3 páginas) · higiene AC1 (diff confinado a §1: `git diff -- apps/scanner-lab packages` = 0 líneas; sin hunks en bloques de lógica) · fingerprint del bundle local: tokens `#030504`/`#e8c84a`×3/`#24357a` servidos, strings «ISO: 1600»/«ÓPTIMA»/«MEDIO»/«BAJA» presentes y «ESPERANDO CAPTURA»/«ESPERANDO IMAGEN»/«PASAR A OFFLINE» 0 hits · QA navegador M21-1 (390×844 + 360×740): AC2-AC11 ALL PASS — colores computados token por token, chip blanco data-driven, fallback de cámara con toast intacto, visor limpio (walk DOM), fila de estado data-driven, chips con anillos colgantes, obturador Ø72 con documento y flujo E2E SIMULACIÓN+IMPORTAR intacto (REVISIÓN 8.1/10.0), consola 0 errores, 0 overflow horizontal, comparación visual 1:1 vs mock sin desviaciones estructurales.
---

## 0-decimoquinto. E14 — CÁMARA FUNCIONAL · ACTAS COMPLETAS · SIMULACIÓN DE SCORES (rama `feat/e14-camara-funcional`, base `feat/e14-rediseno-cyber-neon-captura` @ `aeb2d4f` — PR #31)

**Base:** SPEC-e14-camara-funcional Rev. 1 (ronda de FUNCIONALIDAD — la estética cyber-neón aprobada se conserva al píxel). Tres frentes: (1) botones funcionales + cámara visible, (2) verificación de acta completa (el bug del dueño: «se aceptan las actas que no están completas»), (3) simulación que cicla las 3 actas del dueño (óptima/intermedia/baja).

**Cambios (4 archivos de código + 2 assets + CHANGES.md):**

- **§A `ScanView.tsx` fila de estado:** «ISO: 1600» ELIMINADO (0 apariciones en el bundle) y la fila pasa de `justify-between` a `justify-center` — `● <MODO>` centrado en los 3 modos (petición explícita del dueño). Resto intacto (h-[24px], dot ok-tint, tipografía 10px bold 0.14em).
- **§B `ScanView.tsx` botón ámbar = CAPTURA AUTOMÁTICA** (paridad con el lab CameraView L2350-2382): en CÁMARA alterna el MISMO `autoArmado` del botón inferior «Auto» (sincronizados al instante, ambos `aria-pressed`); ON = mock ámbar + glow 0.35 · OFF = `border-white/25` sin glow + icono white/60. En SIM/IMPORTAR se ve como el mock y el tap produce toast warn «CAPTURA AUTOMÁTICA EN CÁMARA» (ningún control mudo).
- **§C `ScanView.tsx` menú ⋮ FUNCIONAL** (paridad con el lab L2383-2392 + L2878-2911, vestido neón): fondo clickeable a pantalla del visor (`aria-label="Cerrar menú"`), panel `role="menu"` anclado `right-3 top-[60px] w-64` con transición de entrada 150 ms (opacidad + scale-0.97→1, CSS puro vía fase de montaje rAF — sin framer-motion). Filas según modo: SOLO CÁMARA «Captura automática» (Sí/No, ok-tint cuando Sí, alterna SIN cerrar el menú) · TODOS «Escanear con cámara» (`setFuente("CAMARA")`) · TODOS «Importar desde galería» (picker real). Cierre: fondo, botón ⋮ y Escape. `aria-haspopup` + `aria-expanded` en el botón.
- **§D `ScanView.tsx` flash honesto:** el div decorativo pasa a `<button>` con el MISMO visual; en SIM/IMPORTAR el tap produce toast warn «LINTERNA EN CÁMARA». La linterna REAL (F-FLASH v3 del modo CÁMARA) intacta.
- **§E `ScanView.tsx` aviso de cámara con REINTENTO — fin del rebote silencioso** (paridad con el aviso B2 del lab): nuevos estados `avisoCamara` ("denied"/"perdido") + `reintentoCamara` (token que re-dispara el efecto de arranque — deps `[fuente, reintentoCamara]`). Guard sin mediaDevices/inseguro y fracaso tras sondas+cascada → `setCamEstado("no-disponible")` + overlay (antes: toast + rebote a SIMULACIÓN). `track.onended` → overlay «SE PERDIÓ LA CÁMARA» SIN cambio de modo. Cleanup añade `setAvisoCamara(null)`. Overlay: tarjeta `inset-x-4 top-[64px]` con título/cuerpo por variante + [ACTIVAR CÁMARA] (bg-ok-tint → reintento, spinner visible) + [VOLVER A SIMULACIÓN]. Sondas F-LENS v4, cascada, profiler, `video.srcObject` y disparo por plataforma: línea a línea intactos.
- **§F verificación de ACTA COMPLETA (el fix del bug del dueño):**
  - `types.ts`: unión de `rechazo` += `{ tipo: "INCOMPLETA"; detalle: string }` (única línea tocada del archivo).
  - `scanner-core-bridge.ts`: `esActaCompleta(quad)` + `DETALLE_INCOMPLETA`. En el pipeline y en `pipelineRecorte`, ANTES de `evaluarGate`: si `!completa` → `score = min(score, 6.4)` (piso de identificada anulado en la práctica) + `RECHAZADA {INCOMPLETA}` (o `EN_REVISION_HUMANA` al agotar intentos — la contingencia C4 se activa sola) + `clasificacion: null`, SIN tocar `evaluarGate`. El resto del pipeline corre igual (REVISIÓN muestra la imagen). Log `[e14] pipeline`/`[e14] recorte` ahora incluye `completa=` y `quad=[…]` (evidencia de re-auditoría).
  - `store.ts` (`analisisCompletado`, único cambio del archivo): toast rechazo-aware — INCOMPLETA → crit «ACTA INCOMPLETA / Falta parte del acta en el encuadre. Aléjate un poco y repite la foto.»; resto igual que hoy.
- **§G simulación de 3 actas:** assets `acta-sim-intermedia.jpg` (conversión del HEIC del dueño con EXIF aplicado, 1770×2360) y `acta-sim-baja.jpg` (copia 1:1 del JPG del dueño, 1902×1426) + ciclo determinista `ACTAS_SIM` con contador de módulo y caché por índice; `File` con nombre real del asset (.jpg).

**Calibración medida de `esActaCompleta` (ADAPTACIÓN de la Rev. 1, documentada con evidencia):** la fórmula de Rev. 1 (margen 0.02 de los 4 bordes) se midió contra los quads REALES del worker OpenCV con las 3 actas del dueño y resultó INVERTIDA: el acta BUENA (`acta-e14-real.jpg`, encuadre apretado del dueño) produce esquinas a y=0.988/0.998 → con margen 0.02 se RECHAZA el caso bueno (rompe AC9); y las actas CORTADAAS hacen que el worker NO cierre el contorno del papel y devuelva un quad INTERNO (la tabla del acta) que nunca toca el borde → `completa=true` (no arregla AC8). v2 usa DOS señales calibradas: (1) BORDE literal — esquina a ≥0.999 de un borde (el acta buena queda a 0.998 → completa ✓); (2) COBERTURA — área del quad (shoelace) ≥ 0.30 de la foto (medidas: completa 0.389/0.387 · intermedia 0.132/0.069 · baja 0.180) → los fragmentos internos de actas cortadas no pueden «verificarse completos» → INCOMPLETA. El mensaje «ALÉJATE UN POCO Y CAPTURA EL ACTA COMPLETA» también es el consejo correcto para un encuadre lejano.

**Scores medidos (§G-4 — consola `[e14] pipeline`, QA M22-1-bis):**

| Acta | Fase B (worker=deploy real/Vercel) | Fase A (fallback Sobel=GitHub Pages) |
|---|---|---|
| [0] `acta-e14-real.jpg` | `completa=true` · **score=10 · AUTO (FRANKFURT CONSULADO, MESA 012) → 10.0 ÓPTIMA ENVIADA AUTOMÁTICAMENTE** | `completa=true` · 8.1 EN_RH (SUGERIDA, divipol 404 del fallback) |
| [1] `acta-sim-intermedia.jpg` | `completa=false` (área 0.132) · **6.4 RECHAZADA «ACTA INCOMPLETA»** | `completa=false` (área 0.069) · **6.4 RECHAZADA «ACTA INCOMPLETA»** |
| [2] `acta-sim-baja.jpg` | `completa=false` (área 0.180) · **6.4 RECHAZADA «ACTA INCOMPLETA»** | `completa=true` (área 0.493, quad Sobel ancho) · 6.9 EN_RH — no rechazada en el fallback degradado (solo afecta Pages sin worker; en el camino real SÍ se rechaza) |
| recorte (APLICAR sin mover) | `completa=false` · 6.4 · **SIGUE RECHAZADA** (sin bypass) | — |
| HEIC del dueño (vía IMPORTAR) | `completa=false` · 6.4 RECHAZADA INCOMPLETA | — |

Ciclo verificado: 4 disparos consumen [0]→[1]→[2]→[0] (d1 y d4 = 10.0 ÓPTIMA ENVIADA; d2/d3 = 6.4 RECHAZADA INCOMPLETA). Refresh reinicia en [0].

**Defecto menor v1 corregido en v2:** el panel del menú (z-40 Rev. 1) quedaba BAJO el overlay «SIN ACCESO A LA CÁMARA» (z-40, posterior en DOM) cuando coexistían → menú sube a **z-50** (encima del aviso; verificado con hit-test real).

**NO cambiado:** `evaluarGate`/`scoreDeCalidad`/`statusDeScore`/`recortar` firma+timeout — definiciones byte a byte idénticas (diff -U0 verificado); `dispararEscaneo`/`enviarActa`/`repetirFoto`/`aplicarRecorte`/`escalarRevisionHumana` (store: 1 solo hunk §F-6); sondas F-LENS v4, cascada, F-SENSOR-PROFILER, F-FLASH v3, ZSL, disparo por plataforma, rutas iOS; `apps/scanner-lab`/**`packages`** = 0 líneas de diff; `globals.css` (la transición del menú usa solo clases Tailwind); `ReviewView`/`TopBar`/`BottomNav` (neón del PR #30/#31).

**Verificado:** gates 3/3 (`lint:e14` 0 · `e14:check` tsc 0 · build estático 3/3 páginas) · higiene AC1 (diff confinado a §1 + assets; `git diff -- apps/scanner-lab packages` = 0) · fingerprint del bundle: «ISO: 1600»=0, «VOLVIENDO A SIMULACIÓN»=0, «CÁMARA NO DISPONIBLE»=0; «ACTA INCOMPLETA»/«SIN ACCESO A LA CÁMARA»/«ACTIVAR CÁMARA»/«Escanear con cámara»/«LINTERNA EN CÁMARA»/«ACTA ESTÁ CORTADA»/actas del ciclo presentes; 3 JPG en `out/_next/static/media/` · QA navegador M22-1 + M22-1-bis (390×844 + 360×740): ALL PASS en fase B (worker = deploy real/Vercel) — AC2-AC12 con colores computados, hit-tests reales, ciclo completo con desenlaces exactos, recorte sin bypass, HEIC, 0 overflow, 0 page errors; fase A (fallback) sin bloqueantes. 63 screenshots en /home/z/tmp-e14/.

---

## 0-decimosexto. E14 — SIMULACIÓN DE SCORES: los chips SON botones + arranque SIEMPRE en CÁMARA (rama `feat/e14-simulacion-scores`, base main@`256f613` — PR #33 fusionado)

**Base:** SPEC-e14-simulacion-scores Rev. 1. Corrección del modelo mental de la ronda anterior (mandato verbatim del dueño): «lo que entiendes por simulacion simplemente son los botones (scores de ejemplo) que estan encima del boton de capturar, pero por defecto siempre se inicia con camara y las fotos que te deje de ejemplo para los score son para las simulacion, la acta que no esta completa es para el score intermedio, y la borrosa es para score bajo». El ciclo rotativo de la fuente SIMULACIÓN (PR #33 §G) queda INTACTO y fuera de alcance.

**Cambios (4 archivos — `store.ts` · `scanner-core-bridge.ts` · `bridge.ts` · `ScanView.tsx` + CHANGES.md):**

- **§D1 `store.ts` arranque en CÁMARA:** estado inicial `fuente: "SIMULACION"` → `fuente: "CAMARA"` — cada cold start aterriza en CÁMARA (pill AUTO activa, visor vivo u overlay §E sin permiso). No se persiste la última fuente. `[VOLVER A SIMULACIÓN]` del overlay §E verificado funcionando.
- **§D2 `ScanView.tsx` chips = BOTONES:** los 3 chips de calidad pasan de `div` decorativo a `<button>` en la MISMA posición/tamaño/visual del mock aprobado (mismas clases, h-[30px], anillo colgante intacto — AC8). Área táctil ≥44px SIN deformar el visual (`after` invisible −7px/−8px). `active:scale-95` + `cursor-pointer` (único cambio visual permitido). `disabled={procesando}` + opacidad durante análisis; segundo guard en la store (`vista==="analizando"` → ignorado) — triple-click síncrono = **1 solo** `[e14] pipeline` (AC7). `aria-label` exactos de la spec («Simular acta óptima (10.0 — envío automático)» / «…intermedia (7.0 — revisión)» / «…baja (4.3 — rechazada)»). Funcionan en los 3 modos (CÁMARA/SIMULACIÓN/IMPORTAR) sin cámara viva.
- **§D3 inyección determinista (mecánica, sin tocar el gate):**
  - `bridge.ts`: `OpcionesEscaneo` += `simular?: boolean` + `scoreSimulado?: number` (SOLO 2 campos).
  - `scanner-core-bridge.ts`: `fetchActaSimPorScore(score)` — mapeo FIJO dueño 8.2→`acta-e14-real.jpg` · 7.0→`acta-sim-intermedia.jpg` · 4.3→`acta-sim-baja.jpg` (reutiliza `ACTAS_SIM`/`NOMBRES_ACTAS_SIM`/`actasSimCache`; el ciclo rotativo `fetchActaSimulada` queda byte a byte). En `pipeline`: `completa = opciones.simular ? true : esActaCompleta(quad)` (la cortada del chip MEDIO jamás cae INCOMPLETA) y tras `scoreDeCalidad`/antes del gate: `score = scoreSimulado` + re-aplicación del piso identificada §X.3 cuando la clasificación es AUTO (8.2 + AUTO → 10.0). `evaluarGate`/`scoreDeCalidad`/`esActaCompleta` (definiciones) byte a byte. Log añade evidencia ` sim=8.2|7.0|4.3` cuando aplica.
  - `store.ts`: acción nueva `simularScore(banda)` (BandaSim = optima|medio|baja, `SCORE_SIMULADO` = 8.2|7.0|4.3) → `dispararEscaneo(undefined, {simular:true, scoreSimulado})` — el MISMO camino (fuente SIMULACION, guards de ARCHIVO/CAMARA no aplican, no consume archivoPendiente/framePendiente): REVISIÓN, banner, toast, historial, ACTAS y contingencia C4 idénticos a capturas reales. El intento es el vigente del ciclo (chip = UNA captura).
- **§D4 coherencia de desenlaces (todo vía `evaluarGate`, nada forzado a mano):** ver tabla medida abajo. RECORTAR desde sim rechazada NO simula (re-evaluación real). Regresión de completitud por IMPORTAR: cero.

**Desenlaces medidos (dev sandbox 390×844, motor=worker, consola `[e14] pipeline` — divipol 200):**

| Reproducción | Evidencia de consola | Resultado en la app |
|---|---|---|
| Chip ÓPTIMA ×1 | `SIMULACION/file … completa=true quad=[0.293,0.058 … 0.313,0.998] score=10 clasif={dep:88,mun:120,zon:15,std:02,mesa:012,tipo:T,nivel:AUTO} … sim=8.2` | ANALIZANDO → REVISIÓN **«10.0/10 ÓPTIMA»** + FRANKFURT CONSULADO · MESA 012 · TRANSMISIÓN P1 + **«ENVIADO AUTOMÁTICAMENTE»** + ACTAS +1 (foto = acta completa real) |
| Chip MEDIO ×1 | `… completa=true quad=[0.367,0.142 … 0.240,0.538] score=7 clasif={…,nivel:MANUAL} … sim=7` | REVISIÓN **«7.0/10 REVISIÓN HUMANA»** ámbar + **CLASIFICACIÓN PENDIENTE** («Repita la foto… INTENTO 1 DE 4») + toolbar de 3 + CTA ámbar REPETIR CAPTURA (foto = acta cortada) — NO rechazada, NO incompleta, NO enviada |
| Chip BAJA ×1 | `… completa=true quad=[0.117,0.485 … 0.110,0.717] score=4.3 clasif={sin-clasificar} … sim=4.3` | Toast crit **«ACTA NO RECONOCIDA / Score 4.3/10 — obligatorio repetir foto.»** + REVISIÓN **«4.3/10 RECHAZADA»** + toolbar de 3 + **«OBLIGATORIO REPETIR FOTO (INTENTO X DE 4)»** (foto = acta borrosa) |
| BAJA ×4 seguidas | intento 1→4, mismo `score=4.3 sim=4.3` | intento 4 → **contingencia C4**: «4.3/10 REVISIÓN HUMANA» + banner «ENVIADA A REVISIÓN HUMANA / Un auditor validará esta acta» + VOLVER AL ESCÁNER — idéntico a capturas reales |
| RECORTAR desde sim rechazada (APLICAR sin mover) | `[e14] recorte SIMULACION … completa=false score=6.4` (log SIN `sim=`) | **SIGUE RECHAZADA** 6.4 — el rescate por recorte NO simula (re-evaluación real) |
| IMPORTAR la cortada (regresión AC6) | `ARCHIVO/file … completa=false quad=[0.367,0.142 …] score=6.4` (mismo quad que el chip MEDIO — solo cambia `completa` por `simular`) | Toast crit **«ACTA INCOMPLETA / Falta parte del acta…»** + «6.4/10 RECHAZADA» — el fix del PR #33 queda EXACTO |

**Fingerprint del ciclo de intentos por chips:** MEDIO (EN_RH repetir-primero, intento 1) → BAJA (RECHAZADA, «INTENTO 2 DE 4» — el chip CONSUMIÓ el intento del ciclo) → RECORTAR → «INTENTO 3 DE 4» → BAJA ×2 → C4 en intento 4. El contador cuenta CAPTURAS (chips incluidas), candado RH y contingencia al agotar: mismo plumaje de las capturas reales.

**NO cambiado:** `evaluarGate`/`scoreDeCalidad`/`esActaCompleta`/`statusDeScore` definiciones byte a byte; `fetchActaSimulada` (ciclo rotativo §G) byte a byte; `enviarActa`/`repetirFoto`/`aplicarRecorte`/`escalarRevisionHumana`/`guardarUbicacion` (0 líneas); `dispararEscaneo` solo lo mínimo para enrutar la simulación por el camino existente (firma + `fuenteEfectiva`/campos sim — el camino sin `sim` es idéntico); pipeline de recorte (0 líneas); `ReviewView`/`TopBar`/`BottomNav`/`AnalyzingView`/`icons.tsx`/`globals.css` (0 líneas); overlay §E, menú ⋮, botón ámbar, flash honesto, sondas F-LENS v4, ZSL, disparo por plataforma (0 líneas); `apps/scanner-lab`/**`packages`** = 0 líneas de diff; assets (sin binarios nuevos).

**Verificado:** gates 3/3 (`lint:e14` 0 · `e14:check` tsc 0 · build estático 3/3 páginas) · AC9 (`git diff -- packages apps/scanner-lab` = 0) · QA navegador 390×844 + 360×740: AC1-AC8 con hit-tests reales, ciclo completo de chips (ÓPTIMA/MEDIO/BAJA + agotamiento C4 + recorte sin simular + regresión IMPORTAR), chips en los 3 modos, `[VOLVER A SIMULACIÓN]` del overlay, área táctil ::after medida (30px visual + 14px = 44px), overflow horizontal = 0 en escanear y revisión de ambos viewports, **0 page errors / 0 errores de consola**. 14 screenshots en /home/z/tmp-e14/.

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
