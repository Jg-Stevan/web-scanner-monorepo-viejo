// Declaraciones de módulos de imagen estáticos para el gate tsc.
//
// Por qué existe este archivo: `next-env.d.ts` está en el .gitignore raíz y
// por tanto no viaja con el repo. Sin él, nada referencia
// `next/image-types/global` y los imports de .jpg (p. ej. los assets de
// simulación en src/lib/e14/scanner-core-bridge.ts) fallan con TS2307 en
// cualquier checkout limpio (CI). Nunca se vio antes porque el deploy nunca
// ejecutó tsc. Este archivo es aditivo, vive FUERA de src/ (zona congelada
// del track de la saga 5.x) y declara exactamente lo que next-generator
// declara, de forma estable e independiente del .gitignore.

/// <reference types="next/image-types/global" />
