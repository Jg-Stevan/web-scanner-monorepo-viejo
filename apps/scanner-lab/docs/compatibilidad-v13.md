# FIX v13 — Compatibilidad de dispositivos: informe de compatibilidad

> **Rama:** `fix/compatibilidad-dispositivos-v13` DESDE `main` (`255db2d`). **PR ABIERTO, SIN FUSIONAR.**
> **Objetivo:** que un iPhone 8 (12 MP / 3 GB) y un Android de gama media (50 MP / SoC+RAM cortos) completen captura→editar→exportar sin crash, sin cuelgues mudos y sin pantallas rotas — y que cuando algo no se pueda usar, el usuario sepa EXACTAMENTE qué hacer.
> **Regla de oro respetada:** el rendimiento se gana con memoria, CPU de análisis y CSS — NUNCA degradando el dato de imagen (`PROCESSED_MAX_LONG_SIDE=4032`, export máxima y `computeDisplayMaxLongSide()=4032` intactos — verificado en §6).

---

## 1. Matriz navegador × capacidad

Fuente: documentación de APIs (MDN Browser Compatibility / caniuse) y verificación por presencia de API en el código (nada por «ensayo físico» — el QA físico lo hace el dueño en el preview de Vercel). Piso objetivo del proyecto: **iOS 15.x**.

| Capacidad | Safari iOS 15 | Safari iOS 16/17 | Safari iOS 26 | Chrome Android | Firefox Android | WebView social (IG/FB/TikTok) |
|---|---|---|---|---|---|---|
| `getUserMedia` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ no expuesta o bloqueada → banner 13.4 con salida real |
| `ImageCapture` | ❌ (llega en 17, `takePhoto` se cuelga → excluido por UA en el código, `CAN_TAKEPHOTO` solo Android) | ⚠️ expuesta pero `takePhoto` roto (mismo bypass) | ⚠️ igual | ✅ (única plataforma donde el shutter hi-res usa `takePhoto`) | ⚠️ parcial | ❌ |
| torch (`applyConstraints advanced`) | ⚠️ 15.x: no fiable (la app habilita el botón y verifica con `getSettings` al pulsar) | ✅ 16.4+ | ✅ | ✅ | ❌ | ❌ |
| `focusModes` (`getCapabilities`) | ❌ (capabilities vacías) | ❌ | ⚠️ | ✅ (regla D3 del ranking de cámaras) | ❌ | ❌ |
| `createImageBitmap` | ✅ (con `imageOrientation:"from-image"` ignorada sin romper — la cascada reintenta sin opciones) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `createImageBitmap` + `resizeWidth` | ❌ (<16.4) | ✅ 16.4+ | ✅ | ✅ | ✅ | ⚠️ según motor |
| `dvh` | ❌ 15.0–15.3 → **fallback `vh` añadido (13.2)** | ✅ 15.4+ | ✅ | ✅ 108+ | ✅ 101+ | según motor |
| WASM (OpenCV.js/libheif) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| HEIC nativo | ✅ (decodifica HEIC en la cascada nativa — ruta rápida iOS) | ✅ | ✅ | ❌ → rescate heic2any | ❌ → rescate heic2any | ❌ |
| `heic2any` (libheif WASM) | ✅ (5–15 s en gama baja → pill 13.5) | ✅ | ✅ | ✅ | ✅ | ✅ |

**Detección activa en runtime:** `window.__deviceProfile` (13.1) expone `{ tier, cores, memoryGB, ua, dpr, touch, benchMs, ts }` — telemetría QA del dueño en consola remota (tier coherente con la UA emulada; en iOS el micro-benchmark manda).

## 2. Grep de APIs modernas (piso iOS 15.x)

Barrido `rg` sobre `apps/scanner-lab/src` + `packages/scanner-core/src`:

| API | Usos en código ejecutado | Acción |
|---|---|---|
| `.at(` | 0 | — |
| `Object.hasOwn` | 0 | — |
| `structuredClone` | 0 | — |
| `findLast` | 0 | — |
| `toSorted` | 0 | — |
| `replaceAll` | 0 | — |

**Resultado: cero usos** — no hubo nada que reemplazar. El piso iOS 15.x está limpio por construcción.

## 3. Hallazgos A–F: estado final

| # | Hueco (spec) | Estado real en main | Acción v13 |
|---|---|---|---|
| **A** | «0 llamadas a revokeObjectURL» | **YA RESUELTO en main** (verificado): `image-processor.ts` revoca el objectUrl en `finally` tras el decode (líneas ~205-216) y `pdf-export.ts:downloadBlob` revoca con timeout 4 s post-click. Barrido completo del repo: **0 sitios con `createObjectURL` sin revoke**. *OBSERVACIÓN: contradicción interna de la spec — la regla 6 ya describía «el revoke vive en ~199-210».* | Comentarios de invariante anti-regresión (commit 13.3) + propuesta de persistencia §4.1 |
| **B** | Sin `prefers-reduced-motion` ni fallback `dvh` | Confirmado ausente | **FIX (13.2):** bloque estándar reduced-motion + `@supports not (height:100dvh)` con `.h-dvh`/`.min-h-dvh`→`vh` + clase semántica `app-frame-h` (mismo `min(880px,94dvh)`) + 6 targets táctiles a 44 px |
| **C** | Sin perfil de dispositivo consultable | Confirmado ausente | **FIX (13.1):** `lib/device-profile.ts` + `window.__deviceProfile` + campo `tier` aditivo en crash-reporter (y en el meta del banner) |
| **D** | WebViews sociales sin salida | Confirmado ausente | **FIX (13.4):** `isSocialWebView(ua)` + aviso por causa real (`denied/notfound/notreadable/webview/insecure`) con pasos concretos iOS/Android + reintento explica la causa + fallback de galería visible |
| **E** | Import HEIC sin progreso | PARCIAL: existía toast HEIC solo por extensión/MIME (el «.jpg» con contenido HEIC quedaba mudo) | **FIX (13.5):** pill «Convirtiendo imagen… puede tardar unos segundos» anti-parpadeo (300 ms) para CUALQUIER import lento + guard >80 MB + guard de archivo vacío |
| **F** | Landscape/pantallas chicas sin verificar | Sin auditar | **AUDITADO (13.6):** 375×667, 320×568, 667×375 y 844×390 sobre cámara/editor/biblioteca/ajustes → **0 overflow-x, 0 controles recortados/inaccesibles**; FIX de 2 targets 36px (Flash/Captura automática); touch-action v6 verificado intacto |

## 4. NO-fixes con propuesta (decisión del dueño)

### 4.1 Persistencia IndexedDB de la sesión de captura (la propuesta que exige 13.3)

**Por qué salva la sesión en gama baja.** El mayor riesgo real de «buena cámara, poca RAM» no es un leak de object URLs (ya revocados) sino el **jetsam de iOS**: una pestaña con 5–15 páginas de data URLs PNG/JPEG de 4032 px (~15–60 MB vivos por página decodificada más los strings) puede ser descartada por el SO al volver de un cambio de app → **se pierde TODO el trabajo** (hoy la sesión de captura vive solo en memoria del store; solo los documentos GUARDADOS persisten en IndexedDB vía `page-store.ts`).

**Esquema mínimo (2 stores, sin dependencias nuevas):**

```
store "capture_session_v1"  → { id: "session", pages: [{ id, quad, filter, rotation, quality, ocrText }], savedAt }
store "capture_blobs_v1"    → { key: pageId, blob: Blob(original, type/jpeg) }   // el dato pesado, fuera del JSON
```

- Al añadir/capturar página: write-behind (idle) del blob + metadatos. Al arrancar con `capturePages.length===0` y sesión <24 h: restaurar (`Blob → data URL` solo de la página visible; el resto queda como blob hasta abrirse).
- **Riesgos a decidir:** (1) duplicación de escritura en el auto-guardado actual (fusionar ambas rutas en una); (2) cuota (una sesión de 10 páginas ≈ 50–300 MB — Safari exige que el usuario salve el espacio en Ajustes › Safari › Avanzado › Datos de sitios web; iOS 17+ muestra el diálogo de gestión de almacenamiento); (3) coherencia blobs↔metadatos (borrar blobs huérfanos al arrancar); (4) el editor consume data URLs — la restauración perezosa evita decodificar todo de golpe.
- **NO implementado en este PR** (regla 13.3 de la spec). Es el siguiente paso natural si el crash-test v11 confirma que lo que mata la app en gama baja es la presión de memoria total.

### 4.2 Animaciones JS con reduced-motion

El bloque CSS de 13.2 cubre animaciones/transiciones CSS, pero **framer-motion anima por JS** (transiciones de vistas, banners, sheets): un usuario con `prefers-reduced-motion` las sigue viendo. Propuesta: envolver la app en `<MotionConfig reducedMotion="user">` (Providers.tsx, 3 líneas) en un PR futuro — NO tocado aquí para no ampliar el radio del diff.

### 4.3 Observaciones menores (sin acción en este PR)

- **Scroll vertical ~25 px en ventanas landscape ≥640 px:** `app-frame-h = min(880px, 94dvh)` + `py-6` del contenedor suman >100 % de la altura cuando `dvh < 800 px` (preexistente en main, cosmético; los controles siguen accesibles — verificado 844×390).
- **Breakpoint `sm:` (640 px) en móviles grandes en landscape:** un iPhone 12/13 en landscape (844 px) recibe el marco «desktop» centrado de 420 px. Es decisión de diseño preexistente; documentarlo y decidir si el breakpoint debería ser `md:` si se prefiere la UI móvil en landscape.
- **WeChat (`com.tencent.mm`)** no estaba en la lista de patrones de la spec (solo FBAV/FBAN/FB_IAB/Instagram/musical_ly/BytedanceWebview/TikTok/Line/LinkedIn/Snapchat) → **AÑADIDO en v13-post-6** (`MicroMessenger`, 7 UAs reales verificadas: WeChat iOS/Android-XWEB/Windows → `true`; Safari/Chrome reales → `false`; sin regresión de musical_ly/Instagram).
- **La spec referencia fixtures que no existen en main:** `public/qa/*` y el flag `__disableProbe` no están en el árbol actual (probablemente pertenecen a la rama v12 abierta). Los E2E de este PR usaron fixtures propios generados ad-hoc (JPEG sintético, HEIC real mif1, multi-HEIC 774 KB, 0 bytes, texto-renombrado).
- **Telemetrías de la regla 6:** `__lastShutter`, `__displayMax` (=4032), `__displayUrlCalls`, `__editorSource` verificadas intactas. `__captureToEditor`/`__analysisMs`/`__analysisW`/`__prewarm` **no existen en main** (pertenecen al diff v12 sin fusionar) — imposibles de romper desde esta base.

## 5. Riesgos de conflicto con v12 (diff abierto, SIN rebasear)

Archivos tocados por este PR y su distancia a la zona de exclusión v12 (regla 6):

| Archivo v13 | Zonas tocadas | Colisión con zona v12 |
|---|---|---|
| `page.tsx` | SOLO la línea del `className` del marco (≈168: `sm:h-[min(880px,94dvh)]` → `app-frame-h`) | Ninguna: el hunk v12 de ese archivo es el **prewarm** (useEffect, ~73-101), 100 % intacto |
| `CameraView.tsx` | (a) `onFilePicked`: líneas de UI del indicador + guards de tamaño (excepción explícita 13.5; el diff v12 tiene 0 líneas en esa función); (b) top bar: X, ⋮, Flash, Auto (44 px, fuera del pipeline captura→editor); (c) `camNotice`/copy/banner (zona B2 de copy, fuera del pipeline); (d) `noteOpenError()` en los catch de apertura EXISTENTES (observacional, junto a `isPermError` que ya estaba); (e) `retryRealCamera` catch enriquecido | Pipeline captura→editor intacto: `handleCaptureDataUrl`, probe 400 px, orden del flujo de `onFilePicked`, pill «Abriendo editor…» — **0 cambios** |
| `image-processor.ts` | Solo comentarios en la zona del revoke (~199-216) | Zona permitida explícitamente por regla 6; el hunk v12 empieza más abajo (~255+) |
| `EditorView.tsx` | 3 className de targets táctiles en el header | No está en la zona v12 |
| `crash-reporter.ts`, `globals.css`, `device-profile.ts` (nuevo), `webview.ts` (nuevo), `page-store/pdf-export` (comentarios) | No están en la zona v12 | Ninguna |
| `frame-loop.ts`, `detector-client.ts` | **0 líneas tocadas** | — |

## 6. Verificación (evidencia)

- **`tsc --noEmit`:** core = 0 errores · app = 0 errores. **`eslint`:** 0. Sin `next build` (regla 7).
- **Alcance:** `git diff --stat main...HEAD` → 0 archivos de `apps/digitalizador-e14`; solo `apps/scanner-lab` + `packages/scanner-core` + `CHANGES.md`/docs.
- **Dato intocable:** `PROCESSED_MAX_LONG_SIDE = 4032` ✓ · `computeDisplayMaxLongSide()` → `return 4032` ✓ · `window.__displayMax` intacto ✓ · export «máxima» intacta ✓.
- **`__deviceProfile`** legible en consola (8 campos exactos de la spec), tier coherente: bench 23,2 ms → `bajo`; parsing iOS (`platform:"ios", osMajor:15`) y Android (`"android", 13, memoryGB:4`) verificados contra UAs reales.
- **isSocialWebView:** 7 UAs reales (FBAN iOS, Instagram Android, musical_ly iOS/Android, MicroMessenger iOS/Android/Windows → `true`; Chrome normal, WeChat fuera del navegador integrado → `false`). *Fix del word-boundary de `musical_ly` incluido (el `_` rompe `\b`).*
- **E2E no-regresión (headless sobre `next dev`):** import galería JPEG 1600×2200 → editor con la página exacta (dimensiones verificadas en el DOM) · captura sintética → auto-captura → editor · **HEIC mif1 293 KB → editor** (conversión nativa rápida, sin pill — anti-parpadeo correcto) · **multi-HEIC 774 KB → pill «Convirtiendo imagen…» visible a los 2,2 s → editor a los 13,7 s** (ritmo de gama baja) · archivo 0 bytes → toast «El archivo está vacío» · texto-renombrado-.jpg → toast «No se pudo procesar la imagen» · `window.__crashLog` = 0 durante TODA la sesión.
- **`prefers-reduced-motion: reduce`** (emulación Playwright): la app carga, navega biblioteca→cámara→captura→editor sin errores (`matchMedia(...).matches === true` verificado en-page).
- **Landscape/chicas (13.6):** 375×667 · 320×568 · 667×375 · 844×390 × {cámara, editor, biblioteca, ajustes}: `scrollWidth === innerWidth` en todas (0 overflow-x) y 0 botones recortados (barrido de boundingRects). touch-action v6 sin tocar (grep verificado).

## 7. Criterios de aceptación de la spec (sección 4)

- [x] Diff limitado a scanner-lab + scanner-core; 0 archivos e14.
- [x] `tsc` core=0 y app=0 · `eslint`=0 · sin build.
- [x] `__deviceProfile` legible (tier coherente) y campo `tier` en el crash-reporter (+ meta del banner).
- [x] Revoke verificado (revisión de código + barrido del repo; en main ya existían ambos — ver §3.A).
- [x] Playwright `reducedMotion: "reduce"` → app carga y funciona sin errores.
- [x] E2E no-regresión: import galería → editor · captura sintética → editor · HEIC → editor **con pill visible** (multi-HEIC 774 KB).
- [x] `__displayMax=4032` intacto; export «máxima» intacta.
- [x] Informe (este documento) + `CHANGES.md` **0-decimotercero** + PR ABIERTO SIN FUSIONAR.
- [ ] **Preview de Vercel:** pendiente de que el bot de Vercel publique el deployment del PR (el sandbox no puede generarlo); el dueño hace el QA físico ahí (protocolo §5 de la spec).

---

*Fin del informe v13. Las decisiones de merge (y rebase si v12 ya está fusionado) son del dueño.*
