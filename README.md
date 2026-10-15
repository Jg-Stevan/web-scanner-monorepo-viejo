# 📱 Escáner de Documentos — Lab + PWA E-14

> ⚠️ **Regla de oro:** lee [`AGENTS.md`](./AGENTS.md) antes de escribir código — lo que existe en el lab se copia, no se re-inventa.

> 🔬 **Saga de encuadre en pausa** (veredicto del recorte pendiente de dispositivo): protocolo de retoma en [`docs/RETOMA-saga-encuadre.md`](./docs/RETOMA-saga-encuadre.md).

Monorepo de digitalización de documentos con estética **pixel-perfect de iOS**. Toda la interfaz está en **español**.

[![Quality Gate](https://github.com/Jg-Stevan/web-scanner/actions/workflows/quality.yml/badge.svg)](https://github.com/Jg-Stevan/web-scanner/actions/workflows/quality.yml)
![Versión](https://img.shields.io/badge/versión-0.2.1-007AFF)
![Framework](https://img.shields.io/badge/Next.js-16-black)
![Licencia](https://img.shields.io/badge/licencia-MIT-34C759)

---

## 🏗 Arquitectura en 5 líneas

Monorepo con **Bun**: `apps/scanner-lab` (el lab del escáner — la app original de este repo) · `apps/digitalizador-e14` (demo pública de digitalización de actas E-14) · `packages/scanner-core` (tipos, store y lógica compartida). Deploy dual en **GitHub Pages**: raíz = digitalizador-e14 · [`/lab/`](https://jg-stevan.github.io/web-scanner/lab/) = scanner-lab. El CI ([Quality Gate](.github/workflows/quality.yml)) valida tipos + lint + build estático de ambas apps en cada PR.

## 🆕 Novedades — escáner 5.x

- **Captura calidad-primero a resolución completa (4032 px)**: la foto del sensor SIEMPRE gana sobre el preview, y el editor aterriza en segundo plano con upgrade silencioso — en gama baja la foto full-res ya no se descarta (hotfix 5.5.1)
- **Auto-shutter con puntuador de encuadre en vivo**: medidor % + barra en la esquina inferior izquierda, verde al superar el umbral del disparo automático (restaurado en 5.7 sobre la vista limpia)
- **Telemetría de encuadre por página (5.6 · 5.7.1)**: la telemetría viaja como marks `page_framing` (born/detect por página), sobrevive al guardado de la sesión y el informe de diagnóstico trae TODAS las páginas — datos reales para adjudicar recorte-detector vs encuadre-cámara
- **PWA instalable + benchmark del dispositivo + HEIC completo**: «Instalar app», Service Worker network-first, medición CPU/canvas que ajusta la resolución de procesado (4032/3200/2560 px) y fotos HEIC/HEIF de iPhone convertidas solas en el navegador

## 📊 Compatibilidad real

| Dispositivo | SO | Resolución guardada | Captura→guardada | Auto-shutter | OCR | Estado |
|---|---|---|---|---|---|---|
| iPhone (Safari) | iOS 26.6 | 4032 px | 0.31–0.46 s | 0.7–0.8 s auto | 2.4–2.9 s | ✅ calidad 4032 |
| Samsung Galaxy A13 (SM-A135M) | Android | 4032 px (naked→4080) | 1.6–1.9 s rápido · 16–17 s frío | auto (modo calidad) | 40 s frío | ✅ con degradación esperada de gama baja |
| Tecno KN3 | Android | — | — | — | — | 🔬 en veredicto (diag de encuadre) |

*Medido con el diag incorporado (Ajustes › Diagnóstico): exports TXT/JSON con telemetría por página (ENCUADRE, burst, filtros, OCR). Los números de la tabla son medianas de sesión real.*

---

## ✨ Funcionalidades

### 📷 Captura (Pantalla 1)
- Cámara **en vivo** con `getUserMedia` — **Dual Pipeline**: preview ligero 960×540 @ 30 FPS + foto a resolución del sensor vía `ImageCapture.takePhoto()` con tope seguro por gama (Sensor Profiler)
- Selección automática de la lente trasera con enfoque real y **linterna (torch)** con reintento y verificación (sondas secuenciales compatibles con Android)
- **Detección de bordes en tiempo real** en un Web Worker (`public/scanner/detection-worker.js`, motor propio Sobel/DFS con motor OpenCV opcional) con **throttling adaptativo** contra la saturación de gama baja
- Marco azul de detección con handles en las esquinas, indicador de estabilidad, **puntuador de encuadre en vivo** y **auto-captura** (k-de-n frames estables + **compuerta de quietud** por sensor inercial)
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
- Tema claro/oscuro/sistema, mejora automática por captura, OCR automático y calidad PDF
- Panel **"Tu biblioteca"** con estadísticas ampliadas (palabras OCR, papelera, páginas/doc), atajos de teclado y gestos documentados
- **Diagnóstico**: exports TXT/JSON con telemetría por página (encuadre, burst, filtros, OCR) y benchmark del dispositivo

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
| CI | GitHub Actions — Quality Gate (tipos + lint + build estático) |

---

## 🚀 Puesta en marcha

### Requisitos
- **Bun ≥ 1.1** (recomendado) o Node.js ≥ 20 + npm/pnpm
- Navegador moderno con soporte de cámara (la cámara es opcional: hay modo demo e importación de galería)

### Instalación

```bash
# 1. Instalar dependencias del workspace
bun install

# 2. Arrancar el lab del escáner
bun run dev

# (o la demo E-14)
bun run dev:e14
```

Abre <http://localhost:3000> en el navegador.

### Scripts disponibles (raíz del monorepo)

| Comando | Descripción |
|---|---|
| `bun run dev` / `bun run dev:e14` | Servidor de desarrollo (scanner-lab / digitalizador-e14) |
| `bun run build:static` / `bun run build:e14` | Build estático de cada app (GitHub Pages) |
| `bun run core:check` | Type check de `packages/scanner-core` |
| `bun run app:check` / `bun run e14:check` | Type check de cada app |
| `bun run lint` / `bun run lint:e14` | ESLint de cada app |

> **Nota sobre el OCR:** en desarrollo con servidor la app puede usar `/api/ocr` (modelo de visión). En el despliegue estático de GitHub Pages **funciona 100 % con Tesseract.js local** (spa+eng, ~3 MB descargados la primera vez) sin intentar la ruta de servidor. Filtros, detección de bordes, recorte, rotación y PDF son 100 % locales en el navegador: **ni tus documentos ni tus fotos salen de tu dispositivo**.

---

## 📁 Estructura del monorepo

```
├── apps/
│   ├── scanner-lab/            # El lab del escáner (app Next.js, /lab/ en Pages)
│   │   └── src/
│   │       ├── components/scanner/   # Vistas (Camera, Editor, Library, Settings…)
│   │       └── lib/scanner/          # Tipos, store, filtros, OCR, PDF, telemetría
│   └── digitalizador-e14/      # Demo pública de actas E-14 (raíz de Pages)
│       └── src/lib/e14/        # Pipeline de 6 etapas, score, gate, completitud
├── packages/
│   └── scanner-core/           # Tipos, store y lógica compartida
├── AGENTS.md                   # Reglas de trabajo (leer antes de codificar)
├── CHANGES.md                  # Historial de lotes y decisiones
└── .github/workflows/          # quality.yml (gate) + deploy-pages.yml (deploy)
```

---

## 📄 Licencia

[MIT](LICENSE) · OpenCV.js se distribuye bajo Apache 2.0 · Tesseract.js bajo Apache 2.0.
