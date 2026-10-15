# @jg-stevan/scanner-core

Motor headless de escaneo de documentos en el navegador. Sin UI: tú pones la
cámara, el worker y la interfaz; el core pone el motor.

## Qué incluye

Detección de bordes en vivo (cliente de worker), frame loop con auto-shutter
(puntuador de encuadre + compuerta de quietud por sensor inercial), procesado
de imágenes (downscale/warp/filtros/unsharp, HEIC), OCR, exportación PDF/PNG/
texto, gestión de páginas/documentos (zustand), perfilado del sensor y PWA.

## Reglas del contrato

1. Nada de React, Next.js ni imports de UI. Solo TS + zustand (peer) + jspdf.
2. **Los assets (detection-worker.js, OpenCV, service worker) NO viajan en el
   paquete**: viven en el `public/` de tu app. El core los localiza vía
   `process.env.NEXT_PUBLIC_BASE_PATH` (cualquier bundler define process.env
   de build; si tu stack no usa ese nombre, define la variable igualmente).
3. Los exports son aditivos: renombrar o quitar rompe consumidores.

## Uso

```ts
import { SHUTTER_SCORE } from "@jg-stevan/scanner-core/quality";
import type { Quad, ScanDocument } from "@jg-stevan/scanner-core/types";
import { CameraFrameLoop } from "@jg-stevan/scanner-core/frame-loop";
```

Requiere bundler (Next.js, Vite, Bun) — no corre en Node directo (usa
canvas/navigator/localStorage del navegador, con guards de entorno).

Proyecto vivo: https://github.com/Jg-Stevan/web-scanner (apps de referencia:
apps/scanner-lab = consumidor completo de todos los módulos).
