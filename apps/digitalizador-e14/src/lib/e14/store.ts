/**
 * Estado global (zustand): vista activa, acta en revisión, mesas, progreso,
 * historial y conexión. Toda la data nace del
 * bridge (D1) — las vistas nunca tocan el bridge directamente.
 * STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema de
 * notificaciones flotantes queda ELIMINADO (estado + acción + call-sites).
 * El feedback vive en la UI persistente de estado (píldoras, nube, bloque
 * ENVIADO, franja del visor, feedback en botón).
 */
import { create } from "zustand";
import { getBridge } from "./get-bridge";
import { rotateProcessedDataUrl } from "./image-utils";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/ocr";
import type { PageFilter } from "@jg-stevan/scanner-core/types";
import type { PaginaObjetivo } from "./bridge";
import type { Acta, FuenteCaptura, HistorialRow, Mesa, ProgresoAnalisis, TipoPagina } from "./types";
import type { Quad } from "@jg-stevan/scanner-core/types";
import { claveDeMesa, tipoPaginaDe, tituloYUbicacionDe, type ClasificacionE14 } from "./clasificador";
import {
  COLA_OFFLINE_INICIAL,
  SOLICITUDES_RESCANEO_INICIAL,
  historialInicial,
  mesasIniciales,
  progresoInicial,
} from "./seed";

export type Vista = "escanear" | "analizando" | "revision" | "actas" | "resumen";

/** §D3 (SPEC-e14-simulacion-scores): banda de un chip de calidad del mock.
 *  Los ids SON los del mock (ScanView §5) y el mapeo dueño es fijo:
 *  la completa = óptima · la cortada = intermedio · la borrosa = bajo. */
export type BandaSim = "optima" | "medio" | "baja";

/** §D3: score INYECTADO por banda (el del bracket del chip). El desenlace
 *  real lo decide el gate (§D4). §D8.5 (SPEC-e14-score-ocr Rev. 3): la b/n
 *  del dueño as-is = medio 7.0 · la borrosa original as-is = bajo 4.3 ·
 *  8.2 + AUTO → piso 10.0 (ÓPTIMA enviada) · 7.0 con AUTO → ADVERTENCIA
 *  (el chip manda — el piso solo re-aplica con score ≥ 8) · 4.3 →
 *  RECHAZADA. Los mismos números viven pintados en NIVELES_CALIDAD. */
export const SCORE_SIMULADO: Record<BandaSim, number> = {
  optima: 8.2,
  medio: 7.0,
  baja: 4.3,
};

/** §D3: opciones de simulación por chips — SOLO store↔dispararEscaneo; el
 *  bridge las recibe como `simular`/`scoreSimulado` (OpcionesEscaneo). */
export interface OpcionesSimEscaneo {
  simular: boolean;
  scoreSimulado: number;
}

interface E14Store {
  vista: Vista;
  online: boolean;
  actaActual: Acta | null;
  /** Página de mesa apuntada por el escaneo en curso (D7). */
  paginaObjetivo: PaginaObjetivo | null;
  /** Fuente de captura del próximo escaneo (D35: SIMULACIÓN = pipeline real). */
  fuente: FuenteCaptura;
  /** Archivo elegido para la fuente ARCHIVO (L2 lo consume). */
  archivoPendiente: File | null;
  /** Video vivo de la fuente CÁMARA (L3: grab del frame si el disparo no trae foto). */
  framePendiente: HTMLVideoElement | null;
  /** Último evento de progreso del pipeline (alimenta ANALIZANDO, §7.2). */
  progresoAnalisis: ProgresoAnalisis | null;
  /** true cuando el pipeline resolvió (piso escénico D16 de ANALIZANDO). */
  analisisResuelto: boolean;
  /** L5 §7.5: true mientras el bridge re-corre el pipeline del RECORTE. */
  recortando: boolean;
  /** F2 §F2.2: true mientras el bridge re-procesa la foto con un filtro. */
  revelando: boolean;
  actasSesion: number;
  mesas: Mesa[];
  /** Fase B (§6): archivado «dónde va» — clasificaciones guardadas por
   *  clave de mesa real; la vista ACTAS las añade al seed (modo demo). */
  archivadas: Record<string, ActaArchivada>;
  completadas: number;
  asignadasHoy: number;
  colaOffline: number;
  solicitudesRescaneo: number;
  historial: HistorialRow[];

  navegar: (vista: Vista) => void;
  setFuente: (fuente: FuenteCaptura) => void;
  setArchivoPendiente: (archivo: File | null) => void;
  /** Registra el <video> vivo de la cámara (null al detener el stream). */
  setFramePendiente: (frame: HTMLVideoElement | null) => void;
  alternarConexion: () => void;
  /** §7 (SPEC-rediseno-revision): sin `intento` explícito, una captura
   *  CONTINÚA el ciclo de repetición si el acta previa sigue sin resolver
   *  (RECHAZADA o EN_REVISION_HUMANA «repetir-primero») — el contador cuenta
   *  CAPTURAS; ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/agotada) → 1.
   *  §D3 (SPEC-e14-simulacion-scores): `sim` presente SOLO cuando el disparo
   *  viene de un chip (simularScore) — enruta el MISMO camino con fuente
   *  SIMULACION + asset fijo de la banda + score inyectado; los guards de
   *  ARCHIVO/CAMARA no aplican y no consume archivoPendiente/framePendiente. */
  dispararEscaneo: (intento?: number, sim?: OpcionesSimEscaneo) => Promise<void>;
  /** §D2/§D3 (SPEC-e14-simulacion-scores): los 3 chips de calidad encima del
   *  obturador SON botones de simulación — disparan el MISMO camino de
   *  dispararEscaneo (REVISIÓN, banner, toast y ACTAS idénticos) con la fuente
   *  SIMULACION, el asset FIJO de la banda del dueño (la completa = óptima ·
   *  la cortada = intermedio · la borrosa = bajo) y su score inyectado. Nada
   *  se fuerza a mano: el desenlace lo decide `evaluarGate` (§D4) y el ciclo
   *  de intentos/contingencia es el mismo de las capturas reales (AC5). */
  simularScore: (banda: BandaSim) => void;
  analisisCompletado: () => void;
  enviarActa: () => void;
  repetirFoto: () => void;
  /** D6-bis (SPEC-rediseno-chrome-3-estados Rev. 3): escalación MANUAL a
   *  revisión humana — el botón «REVISIÓN HUMANA» (solo ADVERTENCIA/RECHAZADA,
   *  habilitado tras rechazos repetidos) entrega el acta al sabor contingencia
   *  EXACTO del camino automático (§7.5): status EN_REVISION_HUMANA +
   *  intento = maxIntentos (cede el ciclo) + fila de historial + toast.
   *  Sin re-escaneo: NO pasa por el gate ni por el pipeline. */
  escalarRevisionHumana: () => void;
  /**
   * Panel de corrección (SPEC-cabecera-clasificacion §5): persiste la
   * ubicación corregida por el operador como nivel AUTO-manual, archiva su
   * hueco (Fase B §6, con aviso §G.4.1 si duplicado) y pasa al flujo normal
   * de envío (ADVERTENCIA-equivalente).
   */
  guardarUbicacion: (clasificacion: ClasificacionE14) => void;
  /**
   * L5 §7.5 (rescate D20): aplica el recorte manual del QuadEditor —
   * bridge.recortar re-ejecuta el pipeline con el quad manual (F5-MANUAL) y
   * NO consume intento. F4/D37: `rotacionNueva` hornea la rotación LOCAL
   * del editor (undefined = conserva acta.rotation). Toast según resultado.
   */
  aplicarRecorte: (quad: Quad, rotacionNueva?: number) => Promise<void>;
  /**
   * F2 (§F2.2, D36): cambia el filtro del acta — bridge.revelar re-procesa
   * la foto (SOLO processImage, sin re-OCR/re-calidad — igual que
   * setFilterOnPage del core) y el toast copia el texto del lab (L1214-1218).
   */
  cambiarFiltro: (filtro: PageFilter) => Promise<void>;
  /**
   * F-OCR del lab (EditorView.tsx L1360-1395, D39): re-reconoce el texto del
   * acta sobre la PROCESADA y lo guarda. Toaster = copia de los toasts del lab
   * (títulos en mayúsculas = estilo de toasts e14, descripciones verbatim).
   */
  reconocerTextoActa: () => Promise<void>;
  /**
   * L5 §7 ReviewView: gira fotoProcesada 90° (rotateProcessedDataUrl del lab,
   * canvas puro) y hornea rotation para el PDF §6. Gate: foto (D35 — la
   * SIMULACIÓN también rota real).
   */
  rotarFoto: () => Promise<void>;
}

/** Siguiente página a escanear: EN_PROCESO > PENDIENTE > RESCANEO (por mesa). */
function proximaPagina(mesas: Mesa[]): PaginaObjetivo | null {
  const prioridad: Record<string, number> = { EN_PROCESO: 0, PENDIENTE: 1, RESCANEO: 2, OK: 9 };
  let mejor: { mesaId: string; tipo: TipoPagina; pagina: 1 | 2; prio: number } | null = null;
  for (const mesa of mesas) {
    for (const p of mesa.paginas) {
      const prio = prioridad[p.estado] ?? 9;
      if (prio < 9 && (!mejor || prio < mejor.prio)) {
        mejor = { mesaId: mesa.id, tipo: p.tipo, pagina: p.pagina, prio };
      }
    }
  }
  return mejor ? { mesaId: mejor.mesaId, tipo: mejor.tipo, pagina: mejor.pagina } : null;
}

/** Recalcula progresoPct y estado de una mesa tras un cambio de página. */
function recalcularMesa(mesa: Mesa): Mesa {
  const noPendientes = mesa.paginas.filter((p) => p.estado !== "PENDIENTE").length;
  const enProceso = mesa.paginas.some((p) => p.estado === "EN_PROCESO");
  const pendientes = mesa.paginas.some((p) => p.estado === "PENDIENTE");
  const progresoPct = Math.round((noPendientes / mesa.paginas.length) * 100);
  const estado = pendientes || enProceso ? "EN_PROCESO" : "COMPLETADA";
  return { ...mesa, progresoPct, estado: estado as Mesa["estado"] };
}

/** Hueco archivado de una mesa real (§6: cuerpo DELEGADOS|TRANSMISIÓN × pág 1/2). */
export interface HuecoArchivado {
  tipo: TipoPagina;
  pagina: 1 | 2;
}
/** Entrada Fase B (§6): clasificación guardada + huecos ocupados de la mesa. */
export interface ActaArchivada {
  clasificacion: ClasificacionE14;
  huecos: HuecoArchivado[];
}

/**
 * Fase B (§6): archiva el hueco de una clasificación bajo su clave de mesa
 * (códigos con ceros, p. ej. «88-335-05-02-001»). Duplicado del MISMO hueco
 * → reemplaza (la clasificación más reciente queda como vigente) y avisa
 * (análisis §G.4.1). Idempotente: re-archivar el mismo acta es silencioso
 * para el llamador que ignora `duplicado`.
 */
function archivarHueco(
  archivadas: Record<string, ActaArchivada>,
  clasif: ClasificacionE14,
): { nuevas: Record<string, ActaArchivada>; duplicado: boolean } {
  const clave = claveDeMesa(clasif);
  const tipo = clasif.tipo ? tipoPaginaDe(clasif.tipo) : null;
  if (!clave || !tipo) return { nuevas: archivadas, duplicado: false };
  const hueco: HuecoArchivado = {
    tipo,
    pagina: (clasif.pagina?.index ?? 1) === 2 ? 2 : 1,
  };
  const previa = archivadas[clave];
  if (!previa) {
    return {
      nuevas: { ...archivadas, [clave]: { clasificacion: clasif, huecos: [hueco] } },
      duplicado: false,
    };
  }
  const yaEstaba = previa.huecos.some((h) => h.tipo === hueco.tipo && h.pagina === hueco.pagina);
  return {
    nuevas: {
      ...archivadas,
      [clave]: {
        // hueco duplicado → REEMPLAZA (§G.4.1): la foto más reciente gana el hueco.
        clasificacion: clasif,
        huecos: yaEstaba ? previa.huecos : [...previa.huecos, hueco],
      },
    },
    duplicado: yaEstaba,
  };
}

function hashMock(): string {
  const hex = Array.from({ length: 12 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `${hex}…`;
}

/** Guard anti doble-rotación (espejo del rotatingRef del lab L1054 — la
 *  rotación rápida es async y un doble tap giraría 180°). */
let rotandoFotoEnVuelo = false;

export const useE14Store = create<E14Store>((set, get) => {
  const bridge = getBridge();

  const registrarEnvio = (tituloPagina: string) => {
    const { online, historial, completadas, mesas, paginaObjetivo, actaActual, archivadas } = get();
    const hora = bridge.horaHistorial();
    const fila: HistorialRow = {
      id: `h-${Date.now()}`,
      titulo: tituloPagina,
      estado: "ENVIADO",
      hora,
    };
    let colaOffline = get().colaOffline;
    let hash: string;
    if (online) {
      hash = hashMock();
    } else {
      colaOffline += 1;
      hash = "EN COLA";
    }
    const mesasActualizadas = paginaObjetivo
      ? mesas.map((m) =>
          m.id === paginaObjetivo.mesaId
            ? recalcularMesa({
                ...m,
                paginas: m.paginas.map((p) =>
                  p.tipo === paginaObjetivo.tipo && p.pagina === paginaObjetivo.pagina
                    ? { ...p, estado: "OK" }
                    : p,
                ),
              })
            : m,
        )
      : mesas;
    // Fase B (§6): acta con clasificación AUTO (gate o panel) → archiva su
    // hueco. Idempotente: si el panel ya la archivó, el reemplazo es
    // silencioso (mismo acta, mismos datos).
    let archivadasNuevas = archivadas;
    if (actaActual?.clasificacion?.nivel === "AUTO") {
      archivadasNuevas = archivarHueco(archivadas, actaActual.clasificacion).nuevas;
    }
    set({
      historial: [fila, ...historial],
      completadas: Math.min(completadas + 1, get().asignadasHoy),
      colaOffline,
      mesas: mesasActualizadas,
      archivadas: archivadasNuevas,
      actaActual: actaActual ? { ...actaActual, hashSha256: hash } : actaActual,
    });
    return { online, hora };
  };

  const tituloPaginaActual = (): string => {
    const { paginaObjetivo, actaActual } = get();
    // Fase B (§6): título de mesa REAL cuando la clasificación está resuelta.
    const c = actaActual?.clasificacion;
    if (c?.nivel === "AUTO" && c.puesto && c.mesa !== null && c.tipo) {
      const p = (c.pagina?.index ?? 1) === 1 ? "P1" : "P2";
      return `${c.puesto.nombre} · MESA ${c.mesa} — ${tipoPaginaDe(c.tipo)} ${p}`;
    }
    if (!paginaObjetivo) return "MESA 01 — TRANSMISIÓN P1";
    const p = paginaObjetivo.pagina === 1 ? "P1" : "P2";
    return `${paginaObjetivo.mesaId} — ${paginaObjetivo.tipo} ${p}`;
  };

  return {
    vista: "escanear",
    online: true,
    actaActual: null,
    paginaObjetivo: null,
    // §D1 (SPEC-e14-simulacion-scores): la app SIEMPRE arranca en CÁMARA
    // (fuente por defecto del producto — pill AUTO activa, visor vivo u
    // overlay §E del PR #33 sin permiso). Nunca se persiste la última fuente.
    fuente: "CAMARA",
    archivoPendiente: null,
    framePendiente: null,
    progresoAnalisis: null,
    analisisResuelto: false,
    recortando: false,
    revelando: false,
    actasSesion: 0,
    mesas: mesasIniciales(),
    archivadas: {},
    completadas: progresoInicial().completadas,
    asignadasHoy: progresoInicial().asignadasHoy,
    colaOffline: COLA_OFFLINE_INICIAL,
    solicitudesRescaneo: SOLICITUDES_RESCANEO_INICIAL,
    historial: historialInicial(),

    navegar: (vista) => set({ vista }),

    setFuente: (fuente) => set({ fuente }),

    setArchivoPendiente: (archivo) => set({ archivoPendiente: archivo }),

    setFramePendiente: (frame) => set({ framePendiente: frame }),

    alternarConexion: () => {
      const { online, colaOffline, actaActual } = get();
      if (online) {
        set({ online: false });
      } else {
        set({ online: true });
        if (colaOffline > 0) {
          set({
            colaOffline: 0,
            actaActual:
              actaActual && actaActual.hashSha256 === "EN COLA"
                ? { ...actaActual, hashSha256: hashMock() }
                : actaActual,
          });
        }
      }
    },

    dispararEscaneo: async (intentoParam?, sim?) => {
      const { mesas, fuente, archivoPendiente, framePendiente, actaActual: previa } = get();
      // §D3 (SPEC-e14-simulacion-scores): un chip SIEMPRE corre la fuente
      // SIMULACION con el asset fijo de su banda + score inyectado (el bridge
      // resuelve el asset por `scoreSimulado`). No toca archivoPendiente ni
      // framePendiente — los guards de fuentes reales NO aplican (los chips
      // funcionan en los 3 modos, sin cámara viva). Sin `sim`, nada cambia.
      const simActiva = sim?.simular === true && typeof sim.scoreSimulado === "number";
      const fuenteEfectiva: FuenteCaptura = simActiva ? "SIMULACION" : fuente;
      // §7 (SPEC-rediseno-revision): el conteo cuenta CAPTURAS del ciclo de
      // repetición. Una captura SIN intento explícito (importar/disparo del
      // scanner) continúa el ciclo si el acta previa sigue sin resolver
      // (RECHAZADA, o EN_REVISION_HUMANA «repetir-primero» antes de agotar);
      // ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/contingencia agotada) → 1.
      // REPETIR FOTO (repetirFoto) siempre pasa el intento explícito +1.
      const intento =
        intentoParam ??
        (previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" && previa.intento < previa.maxIntentos))
          ? previa.intento + 1
          : 1);
      // L2: en fuente ARCHIVO el disparo necesita imagen (REPETIR FOTO vuelve
      // al picker en vez de reventar el pipeline sin archivo). El aviso vive
      // ahora en la franja del visor de ScanView (pre-check de la vista).
      if (fuenteEfectiva === "ARCHIVO" && !archivoPendiente) {
        set({ vista: "escanear" });
        return;
      }
      // L3: la fuente CÁMARA necesita una captura (foto ZSL/nativa ya en el
      // store) o el video vivo para el grab del frame. REPETIR FOTO vuelve al
      // visor (la cámara se reinicia al reactivar la vista) — espejo de D23.
      // (aviso en la franja del visor de ScanView, §4 del redesign-stitch)
      if (fuenteEfectiva === "CAMARA" && !archivoPendiente && !framePendiente) {
        set({ vista: "escanear" });
        return;
      }
      const objetivo = proximaPagina(mesas);
      set({
        vista: "analizando",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
      });
      try {
        const acta = await bridge.escanearActa({
          objetivo,
          intento,
          maxIntentos: 4,
          fuente: fuenteEfectiva,
          archivo: simActiva ? undefined : (archivoPendiente ?? undefined),
          frameActual:
            !simActiva && fuenteEfectiva === "CAMARA" ? framePendiente : undefined,
          // §D3: campos de simulación SOLO cuando el disparo viene de un chip.
          simular: simActiva ? true : undefined,
          scoreSimulado: simActiva ? sim!.scoreSimulado : undefined,
          onProgreso: (p) => set({ progresoAnalisis: p }),
        });
        set({
          actaActual: acta,
          paginaObjetivo: objetivo,
          actasSesion: get().actasSesion + 1,
          analisisResuelto: true,
          archivoPendiente: null,
        });
        // D7 (SPEC-rediseno-revision §7.5): contingencia automática al
        // AGOTAR intentos — el sistema escala solo (C4), sin botón manual:
        // fila de historial. Con intento < max NO hay historial (aún es
        // «repetir-primero"). El aviso persistente vive en la píldora de
        // estado REVISIÓN HUMANA de la REVISIÓN (redesign-stitch §4.3).
        if (acta.status === "EN_REVISION_HUMANA" && intento >= acta.maxIntentos) {
          const fila: HistorialRow = {
            id: `h-${Date.now()}`,
            titulo: tituloPaginaActual(),
            estado: "REVISION_HUMANA",
            hora: bridge.horaHistorial(),
          };
          set({ historial: [fila, ...get().historial] });
        }
      } catch {
        // Manejo de error del pipeline (§7 store): nunca quedar en analizando.
        set({ vista: "escanear", progresoAnalisis: null, analisisResuelto: false });
      }
    },

    analisisCompletado: () => {
      const { actaActual } = get();
      if (!actaActual) return;
      // D4: ÓPTIMA (≥8) se envía automáticamente al capturar. Offline → el
      // estado persistente vive en la NUBE del TopBar (roja) + la cola de
      // RESUMEN (redesign-stitch §4.3).
      if (actaActual.status === "OPTIMA") {
        const hora = bridge.horaEnvio();
        registrarEnvio(tituloPaginaActual());
        set({
          actaActual: {
            ...get().actaActual!,
            status: "ENVIADA",
            enviadoAutomaticamente: hora,
          },
          vista: "revision",
        });
        return;
      }
      if (actaActual.status === "RECHAZADA") {
        const fila: HistorialRow = {
          id: `h-${Date.now()}`,
          titulo: tituloPaginaActual(),
          estado: "RESCANEO_REQUERIDO",
          hora: bridge.horaHistorial(),
        };
        set({
          solicitudesRescaneo: get().solicitudesRescaneo + 1,
          historial: [fila, ...get().historial],
        });
        // §F-6 (SPEC-camara-funcional) → redesign-stitch §4.3: el motivo del
        // rechazo ya vive PERSISTENTE en la REVISIÓN (píldora de estado +
        // banner + píldora flotante de la tarjeta con el motivo REAL:
        // INCOMPLETA/BAJO/GENÉRICO — D1/PR #33). Sin toast.
      }
      set({ vista: "revision" });
    },

    enviarActa: () => {
      const { actaActual } = get();
      // D20 (L5): envío MANUAL para ADVERTENCIA y también para ÓPTIMA tras un
      // rescate por recorte (el auto-envío D4 solo dispara al capturar — el
      // rescate nunca se auto-envía, evita la doble transmisión).
      if (
        !actaActual ||
        (actaActual.status !== "ADVERTENCIA" && actaActual.status !== "OPTIMA")
      ) {
        return;
      }
      registrarEnvio(tituloPaginaActual());
      set({
        actaActual: { ...get().actaActual!, status: "ENVIADA" },
        vista: "revision",
      });
      // Envío OK / cola offline → NUBE del TopBar + bloque ENVIADO (§4.3).
    },

    repetirFoto: () => {
      const { actaActual } = get();
      const intento = (actaActual?.intento ?? 0) + 1;
      void get().dispararEscaneo(intento);
    },

    simularScore: (banda) => {
      // §D2/§D3 (SPEC-e14-simulacion-scores): un chip es UNA captura del ciclo
      // — reutiliza dispararEscaneo INTACTO (intento vigente: continúa el
      // ciclo si el acta previa sigue sin resolver, ciclo nuevo → 1) para que
      // REVISIÓN, banner, toast, historial, ACTAS y contingencia C4 se
      // comporten idénticos a las capturas reales. El guard cubre el race de
      // un double-tap: vista ya en "analizando" → ignorado (AC7).
      if (get().vista === "analizando") return;
      void get().dispararEscaneo(undefined, {
        simular: true,
        scoreSimulado: SCORE_SIMULADO[banda],
      });
    },

    escalarRevisionHumana: () => {
      const acta = get().actaActual;
      // Guard del dueño: SOLO score intermedio (ADVERTENCIA) y bajo
      // (RECHAZADA). ENVIADA/OPTIMA/EN_RH: no-op.
      if (!acta || (acta.status !== "ADVERTENCIA" && acta.status !== "RECHAZADA")) return;
      const fila: HistorialRow = {
        id: `h-${Date.now()}`,
        titulo: tituloPaginaActual(),
        estado: "REVISION_HUMANA",
        hora: bridge.horaHistorial(),
      };
      set({
        actaActual: { ...acta, status: "EN_REVISION_HUMANA", intento: acta.maxIntentos },
        historial: [fila, ...get().historial],
      });
    },

    guardarUbicacion: (clasificacion) => {
      const { actaActual, archivadas } = get();
      if (!actaActual) return;
      // §5: la corrección del operador es AUTO-manual (confianza plena).
      const final: ClasificacionE14 = {
        ...clasificacion,
        nivel: "AUTO",
        confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
      };
      const { nuevas } = archivarHueco(archivadas, final);
      // §1.4 (SPEC-titulo-ubicacion): la corrección del panel también pasa el
      // título/ubicación al acta (AUTO-manual → el helper aplica).
      const titUbi = tituloYUbicacionDe(final);
      // §5: «pasa a flujo normal de envío (ADVERTENCIA-equivalente)» — la
      // foto era buena, la ubicación ya está corregida.
      set({
        actaActual: {
          ...actaActual,
          clasificacion: final,
          status: "ADVERTENCIA",
          ...(titUbi ? { titulo: titUbi.titulo, ubicacion: titUbi.ubicacion } : {}),
        },
        archivadas: nuevas,
      });
    },

    aplicarRecorte: async (quad, rotacionNueva) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return;
      }
      if (get().recortando) return;
      set({ recortando: true, progresoAnalisis: null });
      try {
        // RecorTE manual → pipeline §5 re-ejecutado con F5-MANUAL; el acta
        // conserva identidad (intento/fuente/paginación) — rescate sin intento.
        // F4/D37: la rotación LOCAL del editor se hornea en fotoProcesada.
        const acta = await bridge.recortar(
          actaActual,
          quad,
          (p) => set({ progresoAnalisis: p }),
          rotacionNueva,
        );
        set({ actaActual: acta, progresoAnalisis: null });
        // El desenlace (RECUPERADA/SIGUE RECHAZADA) vive PERSISTENTE en la
        // píldora de estado de la REVISIÓN (§4.3).
      } catch {
        set({ progresoAnalisis: null });
      } finally {
        set({ recortando: false });
      }
    },

    rotarFoto: async () => {
      const { actaActual } = get();
      // Actas con foto procesada (D35: SIMULACIÓN también — el gate es la foto;
      // F-ROT-RAPID gira la PROCESADA sin re-ejecutar el pipeline).
      if (!actaActual?.fotoProcesada) return;
      if (rotandoFotoEnVuelo) return;
      rotandoFotoEnVuelo = true;
      try {
        // F-ROT-RAPID del lab (L1080): gira la PROCESADA sin re-ejecutar el
        // pipeline; la rotación queda HORNEADA (rotation += 90) para que el
        // PDF §6 y un eventual re-recorte la respeten.
        const { url } = await rotateProcessedDataUrl(actaActual.fotoProcesada, 90);
        set({
          actaActual: {
            ...actaActual,
            fotoProcesada: url,
            rotation: ((actaActual.rotation ?? 0) + 90) % 360,
          },
        });
      } catch {
        // La rotación fallida no cambia estado — el acta conserva su foto.
      } finally {
        rotandoFotoEnVuelo = false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return;
      }
      if (get().revelando) return;
      set({ revelando: true });
      try {
        // F2/D36: revelar = SOLO processImage (sin re-OCR/re-calidad — igual
        // que setFilterOnPage del core); el acta conserva identidad por spread.
        const acta = await bridge.revelar(actaActual, filtro);
        set({ actaActual: acta });
        // El feedback persistente es la PROPIA foto re-velada + el chip del
        // filtro activo en el sheet (§4.3 del redesign-stitch — sin toast).
      } catch {
        set({ actaActual: actaActual });
      } finally {
        set({ revelando: false });
      }
    },

    reconocerTextoActa: async () => {
      const { actaActual } = get();
      // Guard (spec §F2.1): sin foto procesada no hay nada que reconocer.
      // (El estado "corriendo" — ocrRunning del lab L347 — vive en ReviewView.)
      if (!actaActual?.fotoProcesada) {
        return;
      }
      try {
        const texto = await bridge.reconocerTexto(actaActual);
        // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1380-1387
        // (ocrTextIsValid → guardar; «sin texto» se muestra persistente en el
        // propio sheet: contadores a 0 + nota OCR_NO_TEXT del lab).
        if (ocrTextIsValid(texto)) {
          set({ actaActual: { ...actaActual, ocrTexto: texto } });
        }
      } catch {
        // Error de reconocimiento: los contadores del sheet quedan como están.
      }
    },
  };
});
