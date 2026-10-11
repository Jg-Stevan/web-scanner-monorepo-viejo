# 📱 Escáner de Documentos — Clon iOS

> ⚠️ **Regla de oro:** lee [`AGENTS.md`](./AGENTS.md) antes de escribir código — lo que existe en el lab se copia, no se re-inventa.

Aplicación web de digitalización de documentos con estética **pixel-perfect de iOS**, construida como reproducción fiel de 4 diseños originales (Cámara, Editor de perspectiva, Digitalización y Biblioteca). Toda la interfaz está en **español**.

![Versión](https://img.shields.io/badge/versión-fix%20v12-007AFF)
![Framework](https://img.shields.io/badge/Next.js-16-black)
![Licencia](https://img.shields.io/badge/licencia-MIT-34C759)

---

## 🆕 Novedades v5.0.0

- **PWA instalable**: «Instalar app» desde Ajustes (Android/Chrome: prompt nativo · iOS: guía de «Añadir a pantalla de inicio»), Service Worker network-first (sin caché vieja al actualizar) y funcionar **sin conexión**
- **Benchmark del dispositivo**: Ajustes › Rendimiento del dispositivo mide CPU/canvas y ajusta la resolución de procesado (4032/3200/2560 px) para que ningún teléfono se cuelgue
- **Perspectiva mejorada**: cascada de detección multi-umbral (papeles con poco contraste y bordes rotos ya se detectan) y warp a resolución completa del sensor (4032)
- **Rotación instantánea** (~0,2 s): rotar ya NO reprocesa el documento completo
- **Guardar como imagen**: botón «Imagen» en el editor descarga la página actual en PNG
- **Importación robusta**: las fotos de galería/cámara nativa (12–48 MP, EXIF, HEIC) ya no fallan con «No se pudo procesar la imagen»
- **Soporte HEIC completo**: las fotos HEIC/HEIF de iPhone se convierten solas en el navegador (libheif embebido, descarga bajo demanda) — también en Android/Chrome y en los «.jpg» que en realidad traen contenido HEIC
- **Filtro por defecto «B/N adaptativo»** en cada captura nueva
- **Ajustes simplificados**: sin perfiles de documento (detección siempre automática) y sin la página de demo en el editor
- **Dimensiones móviles**: viewport-fit=cover + dvh (sin huecos con las barras del navegador ni recortes en la PWA instalada)

## 🆕 Novedades v6.1

- **Prioridad de resolución en la captura (gama baja)**: la foto a resolución del sensor SIEMPRE gana — un fotograma de vista previa de 720p/1080p ya no puede sustituirla (antes, en teléfonos de entrada, la imagen guardada quedaba ilegible). Si la foto del sensor tarda demasiado (>8 s) se avisa y el fotograma se usa solo como último recurso
- **OCR bajo demanda**: el reconocimiento automático al capturar se apaga por defecto (Ajustes › OCR automático) para ahorrar memoria y batería; el texto se extrae cuando quieras con el botón «Texto» del editor
- **Procesado mínimo de 3200 px también en gama baja**: más lento en dispositivos de entrada, pero el texto nunca deja de ser legible

## 🆕 Novedades v6.2

- **Captura fluida (F-DEFER-CROP)**: el editor abre AL INSTANTE tras capturar — la detección de bordes ya no bloquea la revisión. Un pill «Ajustando recorte…» indica que el recorte automático aterriza en segundo plano y el preview se actualiza solo; si ajustas el recorte a mano, tu decisión manda. En gama baja esto elimina los segundos de espera frente a la cámara sin sacrificar el recorte automático ni la calidad

## 🆕 Novedades v6.3

- **Dual Pipeline de cámara**: el preview pide 960×540 @ 30 FPS (tope suave) para un visor fluido y sin calentamiento en gama baja, mientras la FOTO sale a resolución completa del sensor vía `ImageCapture.takePhoto()` (12–48 MP) — el análisis de bordes sigue viendo lo mismo (remuestreo a 400 px)
- **Sensor Profiler (F-SENSOR-PROFILER)**: mide la resolución nativa del sensor y, en cámaras de 48/108 MP, pide al ISP la foto dentro de un tope seguro por gama (4032 px alta · 3200 px media/baja) — el blob gigante jamás se decodifica y la pestaña ya no crashea; red de seguridad adicional post-decode
- **Estabilizador de quietud (F-STAB)**: la auto-captura exige 280 ms de quietud medida con el sensor inercial (`DeviceMotion`: aceleración ≤ 1.25 m/s², rotación ≤ 14 °/s) más una ventana sostenida del disparo k-de-n — adiós a los disparos mientras acomodas el teléfono (en desktop, y en iOS sin permiso de motion, degrada con elegancia: la auto-captura sigue funcionando)
- **Captura anti tap-shock (F-ZSL)**: buffer Best-Shot de los últimos 8 fotogramas — si la foto de alta resolución no responde, el frame más nítido capturado 80–450 ms ANTES de tu toque sustituye a la foto sacudida por el impacto del dedo (patrón Zero Shutter Lag de las cámaras nativas)
- **Throttling adaptativo (F-PERF)**: el bucle de detección empieza a ~15 FPS y se relaja hasta ~5 FPS si el hilo principal satura (y se recupera solo) — menos stuttering y menos calor en gama baja
- **Filtro «Texto claro» reconstruido (F-TEXT-CLEAN)**: nuevo pipeline con LUT sigmoidal, afilado solo en bordes de tinta (el papel nunca se toca) y reconstrucción cromática que PRESERVA el color de la tinta (bolígrafos azules y sellos rojos ya no se aplastan a negro) — cero píxeles fosforitos y sin halos de croma en la frontera del papel; worker y fallback comparten la misma matemática exacta
- **Limpieza**: eliminado artefacto ZIP de 6.5 MB committeado por error (`public/downloads/`)

## 🆕 Serie FIX v4 → v12 — estabilidad, calidad y fluidez (verificada en gama baja)

> Cada versión pasó auditoría independiente (diff + tsc + eslint + E2E) y QA físico del propietario antes de fusionarse.

- **FIX v3 — Calidad WYSIWYG 4032 px**: un único tope técnico para TODAS las gamas — el benchmark de dispositivo fue eliminado y jamás vuelve a degradar la fuente (las imágenes se procesan y guardan siempre al máximo del lente, capadas a 4032 px por compatibilidad de canvas iOS).
- **FIX v4 — Adiós a la cámara negra**: watchdog de salud del stream (track muerto/congelado → reinicio automático con aviso), lista negra temporal del `takePhoto()` colgado (antes congelaba el visor 5 s) y recuperación honesta con fallback al frame ZSL.
- **FIX v5 — Editor fiel al overlay**: fin del «doble recorte» (lo que viste en vivo es lo que llega al editor: el quad del overlay nace con la página), análisis en modo espera a 2 fps (batería/CPU con el visor abierto sin documento) y flash más fiable.
- **FIX v6 — iOS/Safari a la par**: el reparto de regímenes se decide por plataforma real (Android por UA, no por la existencia de `ImageCapture`, que Safari expone pero cuelga), chequeos de frescura del stream y cascada de apertura más robusta.
- **FIX v7 / v7-b — Auto-captura en iPhone**: subida progresiva del stream a resolución de sensor (ideal 4032, 2 s tras abrir; regla E3 intacta: solo `ideal`) para que la auto-captura por snapshot nazca full-sensor; anillo ZSL con presupuesto de memoria (anti visor-negro en iPhones modestos) y flash verificado aplicando y leyendo el estado real.
- **PR #21 — Pan del editor**: desplazamiento fluido de la página ampliada (pinza/doble-tap) sin saltos ni límites duros.
- **FIX v9 — Auto-captura invariante al FPS**: ventana temporal pura (1200 ms) con K dinámico y sustain de 400 ms — dispara igual en un flagship a 15 fps de análisis que en gama baja a 3 fps (adiós a los «nunca dispara» en equipos lentos y a los falsos disparos en equipos fluidos).
- **FIX v10 — Exportación sin trampas**: chip «Se guardará…» eliminado y migración única de la calidad de exportación a **máxima** para todos los usuarios (ya no existe selector a la baja).
- **FIX v11 — Fuente única 4032 px (permanente)**: el editor Y la presentación a pantalla completa consumen EL MISMO dato (PNG ≤ 4032 px) — fin de la queja «la pantalla completa se ve mejor que el editor». Validado con experimento de crash en gama baja (crash-reporter de solo observación: banner + registro local) sin un solo crash → la red de seguridad de copias de display queda apagada definitivamente.
- **FIX v12 — Fluidez de captura en gama baja («editor primero»)**: tras el disparo ya NO se decodifica la foto de 12 MP antes de navegar — un probe de ≤400 px mide calidad y aspecto, la página nace al instante y el editor abre en ~el tiempo de la HAL de la cámara (antes: 2–8 s mirando el visor). El decode completo vuela en background y solo trabaja si hace algo (cap raro >4032 o ajuste de recorte automático). Además: análisis adaptativo 400→320→280 px según la CPU medida (con histéresis, sin tocar NUNCA los datos), OpenCV precalentado en idle y pill «Abriendo editor…» durante el tramo no reducible del disparo. Telemetría QA: `__captureToEditor`, `__analysisW/Ms`, `__prewarm`.

---

## ✨ Funcionalidades

### 📷 Captura (Pantalla 1)
- Cámara **en vivo** con `getUserMedia` — **Dual Pipeline**: preview ligero 960×540 @ 30 FPS (Android) o alto 1920×1440→4032 (iPhone, fuente de la auto-captura) + foto a resolución del sensor vía `ImageCapture.takePhoto()`, capada al **tope técnico único de 4032 px** (Sensor Profiler + redes de seguridad)
- Selección automática de la lente trasera con enfoque real y **linterna (torch)** con reintento y verificación (sondas secuenciales compatibles con Android)
- **Detección de bordes en tiempo real** en un Web Worker (`public/scanner/detection-worker.js`, motor propio Sobel/DFS con motor OpenCV opcional) con **throttling adaptativo** contra la saturación de gama baja
- Marco azul de detección con handles en las esquinas, indicador de estabilidad y **auto-captura** (ventana temporal pura k-de-n **invariante al FPS del dispositivo** + **compuerta de quietud** por sensor inercial)
- **«Editor primero» (v12)**: tras el disparo el editor abre de inmediato — la foto de 12 MP se decodifica en background, el análisis de bordes se adapta a la CPU (400→320→280 px) y la pill «Abriendo editor…» cubre el tramo del obturador
- **Captura manual con buffer ZSL**: si la foto del sensor no responde, el frame pre-toque más nítido (anti tap-shock) entra como fallback premium
- Sesión **multi-página** con contador, importación desde galería y página de demo

### ✂️ Editor de perspectiva (Pantalla 2)
- Marco de 4 esquinas + 4 puntos medios = **8 handles arrastrables** (pointer events, táctil)
- **Tween animado** al aplicar la detección automática ("Bordes detectados")
- Rotación por página con preview correcto en cualquier ángulo
- Aplicar → recorte + reprocesado real de la imagen

### 📑 Digitalización (Pantalla 3)
- Tabs **Página / Reconocimiento OCR** con segmented control iOS animado
- **OCR doble motor**: servidor (modelo de visión) si existe, o **Tesseract.js local (spa+eng)** en hosting estático — el OCR funciona también en GitHub Pages; **auto-OCR** en segundo plano tras cada captura (con pill de progreso)
- **Exportar PDF** (jsPDF, A4, una página por hoja), **exportar texto a .txt**, copiar todo y **compartir** (Web Share API)
- Badge de calidad (nitidez Laplaciano + contraste + brillo), stats de tamaño/páginas
- **Miniaturas desplegables** (mostrar/ocultar) y **navegación deslizando** horizontalmente entre páginas
- Carrusel de miniaturas + "Añadir página", acciones Recortar / Rotar / **Filtros** / Eliminar
- 3 filtros reales: **Original**, **Texto claro** y **B/N adaptativo** (por defecto en cada captura nueva) — «Texto claro» usa el pipeline F-TEXT-CLEAN: papel blanco limpio sin ruido amplificado, tinta de color preservada (sin aplastar bolígrafos/sellos a negro) y sin halos de croma; los 8 filtros históricos se migran automáticamente al abrir documentos viejos
- **Zoom por pinza/doble-toque** y **comparación antes/después**: mantén pulsada la imagen para ver el original
- Modo presentación a pantalla completa con gestos (pinza, pan, doble-tap)

### 🗂 Biblioteca (Pantalla 4)
- Vista **cuadrícula o lista** (agrupada A-Z por inicial o por tramos temporales)
- Búsqueda en títulos **y texto OCR** (con resaltado de coincidencias al abrir el documento), chips de orden: Recientes / Favoritos / A-Z / **Manual**
- **Reordenar arrastrando** por el asa ⠿ en vista de lista (persistente)
- **Etiquetas** (tags) con colores, filtrado por etiqueta, exportación de biblioteca filtrada
- Selección múltiple, favoritos, duplicar, renombrar, eliminar con confirmación
- **Papelera «Eliminados»** estilo iOS Files: borrado suave con **Deshacer**, restaurar, vaciar y purga automática a los **30 días**
- Exportar **toda la biblioteca** a un único PDF · exportar/compartir el texto OCR de un documento

### ⚙️ Ajustes
- Tema claro/oscuro/sistema, mejora automática por captura y OCR automático — la exportación es SIEMPRE en calidad máxima (sin selector, FIX v10)
- Panel **"Tu biblioteca"** con estadísticas ampliadas (palabras OCR, papelera, páginas/doc), atajos de teclado y gestos documentados

### 🌓 Otros
- **Modo oscuro** completo en todas las vistas
- Persistencia local en **IndexedDB** (documentos, etiquetas, orden manual) — sin base de datos externa
- 4 pasos de **onboarding** la primera vez
- Animaciones Framer Motion, toasts estilo iOS (sonner), vibración háptica donde está disponible

---

## 🛠 Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | **Next.js 16** (App Router) + React 19 |
| Lenguaje | TypeScript 5 (strict) |
| Estilos | Tailwind CSS 4 + shadcn/ui (New York) + variables iOS |
| Estado | Zustand (app) + IndexedDB (persistencia) |
| Visión | Web Worker propio (Sobel + DFS) con motor OpenCV.js opcional |
| OCR | Dual: servidor (modelo de visión) o **Tesseract.js 5 local (spa+eng)** en estático |
| PDF | jsPDF 4 |
| Iconos / animaciones | lucide-react · framer-motion · sonner |

---

## 🚀 Puesta en marcha

### Requisitos
- **Bun ≥ 1.1** (recomendado) o Node.js ≥ 20 + npm/pnpm
- Navegador moderno con soporte de cámara (la cámara es opcional: hay modo demo e importación de galería)

### Instalación

```bash
# 1. Instalar dependencias
bun install        # o: npm install

# 2. (Opcional) configurar variables de entorno
cp .env.example .env

# 3. Arrancar en desarrollo
bun run dev        # o: npm run dev
```

Abre <http://localhost:3000> en el navegador.

### Scripts disponibles

| Comando | Descripción |
|---|---|
| `bun run dev` | Servidor de desarrollo (puerto 3000) |
| `bun run build` | Build de producción (standalone) |
| `bun run start` | Servir el build de producción |
| `bun run lint` | ESLint |
| `bun run db:push` | Sincronizar el schema de Prisma con SQLite *(no requerido por el escáner)* |

> **Nota sobre el OCR:** en desarrollo con servidor la app puede usar `/api/ocr` (modelo de visión). En el despliegue estático de GitHub Pages **funciona 100 % con Tesseract.js local** (spa+eng, ~3 MB descargados la primera vez) sin intentar la ruta de servidor. Filtros, detección de bordes, recorte, rotación y PDF son 100 % locales en el navegador: **ni tus documentos ni tus fotos salen de tu dispositivo**.

---

## 📁 Estructura del proyecto

```
├── apps/
│   ├── scanner-lab/                  # ⭐ El escáner (fuente de verdad)
│   │   ├── public/                   # worker de detección + OpenCV self-hosted
│   │   ├── docs/                     # specs de cada FIX (v4…v12)
│   │   └── src/
│   │       ├── app/page.tsx          # Shell con phone-frame (única ruta visible)
│   │       ├── components/scanner/   # Vistas (Camera, Editor, Library, Settings…)
│   │       └── lib/                  # crash-reporter, db, utils
│   └── digitalizador-e14/            # Subapp hermana — ⛔ NO TOCAR
├── packages/
│   └── scanner-core/src/             # Motor compartido: frame-loop, detector-client,
│                                     #   image-processor (cap 4032), quality, store,
│                                     #   page-store (IndexedDB), motion-stabilizer,
│                                     #   sensor-profiler, ocr, pdf-export, tags…
├── CHANGES.md                        # Registro cronológico de versiones
├── AGENTS.md                         # REGLA DE ORO #0 (lab = fuente de verdad)
└── design-specs.md                   # Especificación de los 4 diseños originales
```

---

## 🎨 Sistema de diseño iOS

| Token | Valor |
|---|---|
| Azul primario | `#007AFF` |
| Fondo claro | `#F2F2F7` |
| Rojo destructivo | `#FF3B30` |
| Verde éxito | `#34C759` |
| Gris secundario | `#8E8E93` |
| Tipografía | SF Pro / system-ui |
| Radio de tarjeta | 12px · Vista "phone" 44px |

La app se muestra dentro de un **phone-frame** centrado en escritorio y a pantalla completa en móvil, con safe-areas y home indicator.

---

## 📄 Licencia

[MIT](LICENSE) · OpenCV.js se distribuye bajo Apache 2.0 · Tesseract.js bajo Apache 2.0.
