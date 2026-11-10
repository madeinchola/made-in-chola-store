import type { FunctionResult } from "@/lib/functions";
import { UNDO_DURATION_MS } from "./constants";
import { type CartStorage, isPendingFresh } from "./storage";
import {
  COUPON_REASONS,
  type CartLine,
  type CartRequestBody,
  type CartResponse,
  type CartSnapshot,
  type CouponClientReason,
  type CouponReason,
  type ItemOutcome,
  type ItemResult,
} from "./types";

export interface CartApi {
  request(body: CartRequestBody): Promise<FunctionResult<CartResponse>>;
}

export type CartIdentity =
  { kind: "unknown" } | { kind: "guest" } | { kind: "user"; userId: string };
export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface MergeReport {
  merged: number;
  adjusted: number;
  skipped: number;
}

/** Por qué NO se pudo poner un cupón (solo cuando el servidor lo rechazó sin guardarlo, o no se pudo preguntar). */
export interface CouponNotice {
  /** Lo que escribió la persona. */
  code: string;
  reason: CouponReason | CouponClientReason;
  /** Con `min_not_reached`: cuánto falta (importe en la moneda de la bolsa). */
  missing: number | null;
}

export interface CartState {
  identity: CartIdentity;
  /** Ya hay una foto (del servidor o del espejo local) de esta identidad. */
  loaded: boolean;
  snapshot: CartSnapshot | null;
  /** Cantidades pedidas y aún no confirmadas por el servidor (lo que el cliente ve de inmediato). */
  pending: Record<string, number>;
  /** Aviso por variante tras el último cambio (se ajustó, hay tope, no se pudo agregar). */
  results: Record<string, ItemResult>;
  lastRemoved: { variantId: string; qty: number; name: string } | null;
  sync: { state: SyncState; code?: string; retryAfter?: number };
  /** servidor − dispositivo, en ms: la cuenta regresiva usa la hora del servidor (relojes mal puestos). */
  clockOffsetMs: number;
  mergeReport: MergeReport | null;
  /**
   * Hay una petición para reservar de nuevo (la automática al vencer la cuenta regresiva o «Reintentar reserva») esperando
   * turno o en vuelo. La pantalla dice «Reservando de nuevo…» en vez de «Ya no reservamos…» mientras dura: si había stock,
   * ese segundo aviso aparecía y desaparecía (parpadeo).
   */
  reserving: boolean;
  /**
   * Cupón (S9). `busy`: hay una petición de poner o quitar en camino. `notice`: el último rechazo que NO queda guardado en
   * la bolsa (código inexistente, vencido, otro cupón ya puesto…). Un cupón guardado que hoy no baja nada (mínimo no
   * alcanzado…) se lee de la foto: `snapshot.discounts.coupon`.
   */
  coupon: { busy: boolean; notice: CouponNotice | null };
}

export type CartEvent =
  { type: "removed"; line: CartLine; quantity: number; currency: string } | { type: "viewed" };

export interface CartStoreOptions {
  api: CartApi;
  storage: CartStorage;
  now?: () => number;
  /** Otras pestañas: avisa tras un cambio y llama a `onMessage` cuando otra lo hace. */
  channel?: { post(): void; subscribe(onMessage: () => void): () => void } | null;
  onEvent?: (event: CartEvent) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const INITIAL: CartState = {
  identity: { kind: "unknown" },
  loaded: false,
  snapshot: null,
  pending: {},
  results: {},
  lastRemoved: null,
  sync: { state: "idle" },
  clockOffsetMs: 0,
  mergeReport: null,
  reserving: false,
  coupon: { busy: false, notice: null },
};

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
/** Reintentos seguidos ante un error del servidor (5xx, 408) antes de rendirse con ese cambio. */
const MAX_TRANSIENT_RETRIES = 5;

const ITEM_OUTCOMES: readonly ItemOutcome[] = [
  "ok",
  "adjusted",
  "capped_variant",
  "capped_units",
  "removed",
  "out_of_stock",
  "unavailable",
  "limit_lines",
  "limit_units",
  "token_retired",
];
const isItemOutcome = (value: unknown): value is ItemOutcome =>
  typeof value === "string" && (ITEM_OUTCOMES as readonly string[]).includes(value);

/** El motivo que manda el servidor; cualquier otra cosa se lee como un código inválido (nunca se inventa un motivo). */
const asCouponReason = (value: unknown): CouponReason =>
  typeof value === "string" && (COUPON_REASONS as readonly string[]).includes(value)
    ? (value as CouponReason)
    : "invalid_code";

/** ¿Lo que llegó parece una respuesta del carrito? (un 200 con cuerpo vacío o raro no debe romper el almacén). */
function isCartResponse(data: unknown): data is CartResponse {
  return (
    data !== null &&
    typeof data === "object" &&
    typeof (data as { token_state?: unknown }).token_state === "string"
  );
}

/**
 * Estado del carrito SIN React (se prueba entero con una API de mentira). Reglas:
 *  · El servidor manda: cada respuesta REEMPLAZA la foto; el cliente solo ve de inmediato sus propias cantidades
 *    pendientes (`pending`).
 *  · Una sola petición en vuelo a la vez (cola): ninguna respuesta puede llegar fuera de orden.
 *  · Las operaciones fijan cantidades ABSOLUTAS y se juntan por variante: diez clics en «+» son una petición con la
 *    cantidad final, y un reintento no duplica nada.
 *  · Sin conexión se conserva lo pendiente y se reintenta (al volver la red o con espera creciente).
 *  · Al cambiar de identidad (login, logout) todo se descarta: una petición que vuelve tarde no contamina la nueva.
 */
export class CartStore {
  private state: CartState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private flushQueued = false;
  /** Ya hay una lectura esperando su turno: otra igual no se encola (la cola es de una en una). */
  private getQueued = false;
  private epoch = 0;
  private retryHandle: unknown = null;
  private undoHandle: unknown = null;
  private retryAttempt = 0;
  /** Peticiones de «reservar de nuevo» sin terminar (de cualquier época): `state.reserving` es `> 0`. */
  private reserveInFlight = 0;
  private lastExpiryRefreshed: string | null = null;
  /** Lo que la persona escribió en el último intento de cupón (para decirle «ese código…» si se rechaza). */
  private lastCouponTyped = "";
  private lastFetchAt = 0;
  private unsubscribeChannel: (() => void) | null = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: CartStoreOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.subscribeChannel();
  }

  private subscribeChannel(): void {
    if (this.unsubscribeChannel || !this.options.channel) return;
    this.unsubscribeChannel = this.options.channel.subscribe(() => {
      void this.refetch();
    });
  }

  // ── Suscripción (useSyncExternalStore) ────────────────────────────────────────────────────
  getState = (): CartState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<CartState>): void {
    this.state = { ...this.state, ...patch };
    // Todo cambio de lo pendiente se guarda (o se borra al quedar vacío): sobrevive a una recarga sin conexión.
    if ("pending" in patch) this.persistPending();
    for (const listener of [...this.listeners]) listener();
  }

  /** Quién es el dueño de lo pendiente guardado: «guest» o «user:<id>» (null mientras no se sabe quién es). */
  private ownerOf(identity: CartIdentity): string | null {
    if (identity.kind === "guest") return "guest";
    if (identity.kind === "user") return `user:${identity.userId}`;
    return null;
  }

  private persistPending(): void {
    const owner = this.ownerOf(this.state.identity);
    if (!owner) return;
    if (Object.keys(this.state.pending).length === 0) {
      this.options.storage.clearPending();
      return;
    }
    this.options.storage.writePending({
      owner,
      pending: { ...this.state.pending },
      savedAt: this.now(),
    });
  }

  /**
   * Lo pendiente que quedó guardado para ESTA identidad (una recarga sin conexión, p. ej.). Lo de otro dueño o lo vencido
   * se borra: quien cierra sesión o cede el equipo no deja nada suyo, y nadie hereda cambios ajenos.
   */
  private restorePending(identity: CartIdentity): Record<string, number> {
    const owner = this.ownerOf(identity);
    if (!owner) return {};
    const saved = this.options.storage.readPending();
    if (!saved) return {};
    if (saved.owner === owner && isPendingFresh(saved.savedAt, this.now())) return saved.pending;
    this.options.storage.clearPending();
    return {};
  }
  /**
   * Suelta lo vivo (temporizador, canal, lo que vuela) SIN olvidar nada: se puede volver a `connect()`. Es lo que hace
   * React en desarrollo (`StrictMode` monta, desmonta y vuelve a montar): si fuera definitivo, quien tiene sesión se
   * quedaba sin cargar su bolsa hasta entrar a /carrito.
   */
  disconnect(): void {
    this.cancelRetry();
    this.clearUndoTimer();
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.flushQueued = false;
    this.getQueued = false;
    this.epoch++;
  }

  /** Vuelve a engancharse tras `disconnect()` (o al montar): canal de otras pestañas, lectura inicial y lo pendiente. */
  connect(): void {
    this.subscribeChannel();
    if (this.state.identity.kind === "unknown") return;
    if (this.lastFetchAt === 0) void this.refetch();
    if (Object.keys(this.state.pending).length > 0) this.scheduleFlush();
  }

  /** Fin definitivo (pruebas, desmontaje total). */
  destroy(): void {
    this.disconnect();
    this.listeners.clear();
  }

  // ── Identidad ─────────────────────────────────────────────────────────────────────────────
  setIdentity(identity: CartIdentity): void {
    const current = this.state.identity;
    const same =
      current.kind === identity.kind &&
      (current.kind !== "user" || (identity.kind === "user" && current.userId === identity.userId));
    if (same) return;
    this.epoch++;
    this.cancelRetry();
    this.clearUndoTimer();
    this.flushQueued = false;
    this.getQueued = false;
    this.lastExpiryRefreshed = null;
    this.lastFetchAt = 0;
    // Un usuario nunca ve (ni deja) nada del anterior: la foto, lo pendiente y los avisos empiezan de cero.
    const mirror = identity.kind === "guest" ? this.options.storage.read() : null;
    const pending = this.restorePending(identity);
    this.state = {
      ...INITIAL,
      identity,
      loaded: identity.kind === "guest",
      snapshot: identity.kind === "guest" ? (mirror?.snapshot ?? null) : null,
      pending,
    };
    for (const listener of [...this.listeners]) listener();
    if (identity.kind === "guest" && mirror) void this.refetch();
    if (identity.kind === "user") void this.refetch();
    // Lo que quedó sin confirmar antes de recargar se envía ahora (después de leer la bolsa, que va primero en la cola).
    if (Object.keys(pending).length > 0) this.scheduleFlush();
  }

  // ── Lecturas ──────────────────────────────────────────────────────────────────────────────
  refetch(): Promise<void> {
    if (this.getQueued) return this.chain;
    this.getQueued = true;
    return this.enqueue(async (epoch) => {
      this.getQueued = false;
      if (this.state.identity.kind === "unknown") return;
      if (this.state.identity.kind === "guest" && !this.token()) {
        // Un invitado sin token no tiene bolsa que leer: ya está «cargado» y vacío desde `setIdentity`. Solo se toca el
        // estado si algo cambia (no se repinta toda la tienda por no hacer nada).
        if (this.epoch === epoch && (!this.state.loaded || this.state.snapshot !== null)) {
          this.set({ loaded: true, snapshot: null });
        }
        return;
      }
      await this.send(epoch, { action: "get" });
    });
  }

  /** Para `visibilitychange`: no repite la consulta si se hizo hace poco. */
  refetchIfStale(maxAgeMs = 30_000): void {
    if (this.now() - this.lastFetchAt > maxAgeMs) void this.refetch();
  }

  // ── Escrituras ────────────────────────────────────────────────────────────────────────────
  /** Fija la cantidad de una variante (0 = quitar). Se ve al instante; el servidor confirma y ajusta. */
  setQty(variantId: string, qty: number): void {
    const clean = Math.max(0, Math.min(1000, Math.floor(Number.isFinite(qty) ? qty : 0)));
    const { [variantId]: _drop, ...results } = this.state.results;
    void _drop;
    // «Deshacer» sigue disponible mientras se tocan OTRAS líneas; solo se invalida si se cambia la misma.
    const lastRemoved =
      this.state.lastRemoved?.variantId === variantId ? null : this.state.lastRemoved;
    if (lastRemoved !== this.state.lastRemoved) this.clearUndoTimer(); // ya no hay nada que caducar
    this.set({
      pending: { ...this.state.pending, [variantId]: clean },
      results,
      lastRemoved,
    });
    this.scheduleFlush();
  }

  /**
   * «Agregar a la bolsa»: suma UNA unidad a lo que ya hay. Como las cantidades son absolutas, necesita saber lo que hay: si
   * la bolsa todavía no se leyó (se acaba de entrar a la ficha, o la lectura falló), ESPERA a leerla en vez de adivinar
   * 0: adivinar mandaba «1» y dejaba en 1 una bolsa que tenía 3, en silencio. Si no se puede leer, no se envía nada
   * y el aviso de error lo dice. Es síncrono cuando ya está cargada (dos clics seguidos suman 2).
   */
  async addOne(variantId: string): Promise<void> {
    if (this.state.identity.kind === "unknown") await this.waitForIdentity();
    if (!this.state.loaded) await this.refetch();
    if (!this.state.loaded) return; // no se pudo leer la bolsa: el estado ya trae el error
    const current =
      this.state.pending[variantId] ??
      this.state.snapshot?.lines.find((line) => line.variant_id === variantId)?.qty ??
      0;
    this.setQty(variantId, current + 1);
  }

  private waitForIdentity(): Promise<void> {
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (this.state.identity.kind === "unknown") return;
        unsubscribe();
        resolve();
      });
    });
  }

  remove(variantId: string): void {
    const line = this.state.snapshot?.lines.find((l) => l.variant_id === variantId);
    if (!line) return;
    const qty = this.state.pending[variantId] ?? line.qty;
    this.setQty(variantId, 0);
    this.set({ lastRemoved: { variantId, qty, name: line.name } });
    // La posibilidad de deshacer CADUCA aquí (no en un componente: si la página se cierra, un «Deshacer» viejo no debe
    // quedar vivo para aparecer horas después en otro lugar, p. ej. en el cajón).
    this.clearUndoTimer();
    this.undoHandle = this.setTimer(() => {
      this.undoHandle = null;
      this.dismissUndo();
    }, UNDO_DURATION_MS);
    this.options.onEvent?.({
      type: "removed",
      line,
      quantity: qty,
      currency: this.state.snapshot?.currency ?? "BOB",
    });
  }

  undoRemove(): void {
    const removed = this.state.lastRemoved;
    if (!removed) return;
    this.setQty(removed.variantId, removed.qty);
  }

  dismissUndo(): void {
    this.clearUndoTimer();
    if (this.state.lastRemoved) this.set({ lastRemoved: null });
  }

  private clearUndoTimer(): void {
    if (this.undoHandle !== null) this.clearTimer(this.undoHandle);
    this.undoHandle = null;
  }

  dismissResult(variantId: string): void {
    const { [variantId]: _drop, ...results } = this.state.results;
    void _drop;
    this.set({ results });
  }

  dismissMergeReport(): void {
    if (this.state.mergeReport) this.set({ mergeReport: null });
  }

  clear(): Promise<void> {
    this.set({ pending: {}, results: {}, lastRemoved: null });
    return this.enqueue(async (epoch) => {
      await this.send(epoch, { action: "clear" });
    });
  }

  /**
   * Acepta el precio vigente de una línea (o, sin `variantId`, de todas las de garantía vencida). Con `variantId` manda el
   * precio que la persona está VIENDO ahora: si el servidor ya tiene otro, no acepta nada y el aviso vuelve con el nuevo.
   */
  acceptPrices(variantId?: string): Promise<void> {
    const seen = variantId
      ? this.state.snapshot?.lines.find((line) => line.variant_id === variantId)?.current_price
      : null;
    const body: CartRequestBody = variantId
      ? {
          action: "accept_prices",
          variant_id: variantId,
          ...(typeof seen === "number" && seen > 0 ? { expected_price: seen } : {}),
        }
      : { action: "accept_prices" };
    return this.enqueue(async (epoch) => {
      await this.send(epoch, body);
    });
  }

  /**
   * Pone un cupón en la bolsa. El servidor decide: si lo acepta (o lo guarda aunque hoy no baje nada, p. ej. por el
   * mínimo) la foto trae el descuento o el motivo; si lo rechaza deja un `coupon.notice`. NO se reintenta solo (cada
   * intento cuenta para el tope contra la fuerza bruta de códigos).
   */
  applyCoupon(code: string): Promise<void> {
    const typed = code.trim().slice(0, 40);
    this.lastCouponTyped = typed;
    if (typed === "") {
      this.set({
        coupon: { busy: false, notice: { code: "", reason: "invalid_code", missing: null } },
      });
      return Promise.resolve();
    }
    this.set({ coupon: { busy: true, notice: null } });
    return this.enqueue(async (epoch) => {
      const outcome = await this.send(epoch, { action: "set_coupon", code: typed });
      if (outcome !== "ok" && this.epoch === epoch) {
        // No se pudo preguntar (sin red, error del servidor, demasiados intentos): se dice, sin guardar nada.
        const reason: CouponClientReason =
          this.state.sync.code === "rate_limited" ? "rate_limited" : "unavailable";
        this.set({ coupon: { busy: true, notice: { code: typed, reason, missing: null } } });
      }
    }).finally(() => {
      if (this.state.coupon.busy) this.set({ coupon: { ...this.state.coupon, busy: false } });
    });
  }

  /** Quita el cupón de la bolsa (idempotente). */
  removeCoupon(): Promise<void> {
    this.set({ coupon: { busy: true, notice: null } });
    return this.enqueue(async (epoch) => {
      await this.send(epoch, { action: "remove_coupon" });
    }).finally(() => {
      if (this.state.coupon.busy) this.set({ coupon: { ...this.state.coupon, busy: false } });
    });
  }

  /** Cierra el aviso del último rechazo. */
  dismissCouponNotice(): void {
    if (this.state.coupon.notice) this.set({ coupon: { ...this.state.coupon, notice: null } });
  }

  /** La retención venció: se reintenta UNA vez por vencimiento (si no, cada repintado repetiría la petición). */
  reservationExpired(): Promise<void> {
    const key = this.state.snapshot?.reservation.expires_at ?? "none";
    if (this.lastExpiryRefreshed === key) return Promise.resolve();
    this.lastExpiryRefreshed = key;
    return this.reserveAgain();
  }

  /**
   * El clic de la persona en «Reintentar reserva»: SIEMPRE pide a la base que retenga lo que falte (sin la guarda por
   * vencimiento de arriba, que solo evita repetir la llamada AUTOMÁTICA al llegar a 0). El servidor no alarga lo que ya
   * está retenido, así que repetirlo no regala tiempo.
   */
  retryReservation(): Promise<void> {
    return this.reserveAgain();
  }

  /** Pide `refresh` y marca `reserving` desde que se encola hasta que termina (también si la época cambió o falló). */
  private reserveAgain(): Promise<void> {
    this.reserveInFlight++;
    if (!this.state.reserving) this.set({ reserving: true });
    return this.enqueue(async (epoch) => {
      await this.send(epoch, { action: "refresh" });
    }).finally(() => {
      this.reserveInFlight--;
      if (this.reserveInFlight === 0 && this.state.reserving) this.set({ reserving: false });
    });
  }

  /** Tras iniciar sesión: pasa el carrito de invitado al del usuario (idempotente) y deja el equipo limpio. */
  mergeGuest(userId: string): Promise<void> {
    // Sin bolsa de invitado no hay nada que fusionar: se responde AL INSTANTE. Encolarse detrás de la lectura de la bolsa
    // del usuario retrasaba el inicio de sesión (el gancho espera esta promesa, hasta 3 s) cuando la función tardaba en
    // contestar, aunque no hubiera nada que hacer: justo el caso de casi todos los inicios de sesión.
    if (!this.token()) return Promise.resolve();
    let attempted = false;
    return this.enqueue(async (epoch) => {
      const identity = this.state.identity;
      if (identity.kind !== "user" || identity.userId !== userId) return;
      const token = this.token();
      if (!token) return; // nada que fusionar: ni petición ni relectura
      attempted = true;
      const res = await this.options.api.request({ action: "merge", cart_token: token });
      if (this.epoch !== epoch) return;
      if (!res.ok) {
        this.fail(res);
        return;
      }
      if (!isCartResponse(res.data)) {
        this.fail({ ok: false, status: 502, code: "bad_response", message: "bad_response" });
        return;
      }
      // Fusionado (o no había nada que fusionar): el token ya no sirve y el equipo no guarda nada del invitado.
      this.options.storage.clear();
      const data = res.data;
      this.applyResponse(data);
      if (
        data.merged &&
        (data.merged_lines ?? 0) + (data.adjusted_lines ?? 0) + (data.skipped_lines ?? 0) > 0
      ) {
        this.set({
          mergeReport: {
            merged: data.merged_lines ?? 0,
            adjusted: data.adjusted_lines ?? 0,
            skipped: data.skipped_lines ?? 0,
          },
        });
      }
      this.options.channel?.post();
    }).then(() => (attempted ? this.refetch() : undefined));
  }

  /** La sesión se renovó: si lo pendiente se había quedado esperando por una sesión vencida (401), se reintenta. */
  sessionRefreshed(): void {
    if (this.state.sync.state === "error" && this.state.sync.code === "session") this.retryNow();
  }

  /** Para el evento `online` y el botón «reintentar». */
  retryNow(): void {
    this.cancelRetry();
    this.retryAttempt = 0;
    if (Object.keys(this.state.pending).length > 0) this.scheduleFlush();
    void this.refetch();
  }

  // ── Interno ───────────────────────────────────────────────────────────────────────────────
  private token(): string | null {
    return this.options.storage.read()?.token ?? null;
  }

  private enqueue(task: (epoch: number) => Promise<void>): Promise<void> {
    const epoch = this.epoch;
    const run = this.chain.then(() => (this.epoch === epoch ? task(epoch) : undefined));
    this.chain = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    void this.enqueue(async (epoch) => {
      this.flushQueued = false;
      await this.flush(epoch);
    });
  }

  private async flush(epoch: number): Promise<void> {
    for (;;) {
      if (this.epoch !== epoch) return;
      const entry = Object.entries(this.state.pending)[0];
      if (!entry) return;
      const [variantId, qty] = entry;
      this.set({ sync: { state: "syncing" } });
      const outcome = await this.send(
        epoch,
        { action: "set_item", variant_id: variantId, qty },
        variantId,
      );
      if (this.epoch !== epoch) return;
      if (outcome === "hold") return; // sin red, límite de tasa o sesión vencida: lo pendiente se conserva
      if (outcome === "drop") continue; // ese cambio no tenía arreglo y ya se descartó: sigue con el resto
      // Si mientras volaba la petición el cliente volvió a cambiar esa variante, queda pendiente con el valor nuevo.
      if (this.state.pending[variantId] === qty) {
        const { [variantId]: _done, ...rest } = this.state.pending;
        void _done;
        this.set({ pending: rest });
      }
    }
  }

  /**
   * Envía una petición y aplica la respuesta. `ok`: aplicada · `hold`: no salió pero se conserva y se reintentará ·
   * `drop`: falló sin remedio (se descarta ese cambio pendiente).
   */
  private async send(
    epoch: number,
    body: CartRequestBody,
    variantId?: string,
  ): Promise<"ok" | "hold" | "drop"> {
    const withToken = this.withToken(body);
    const sentQty = body.action === "set_item" ? body.qty : undefined;
    const res = await this.options.api.request(withToken);
    if (this.epoch !== epoch) return "hold"; // identidad cambiada mientras volaba: se descarta
    this.lastFetchAt = this.now();
    if (!res.ok) return this.fail(res, variantId, sentQty);
    if (!isCartResponse(res.data)) {
      // Un 200 con un cuerpo que no es del carrito se trata como un error del servidor: se reintenta y no se queda «sincronizando».
      return this.fail(
        { ok: false, status: 502, code: "bad_response", message: "bad_response" },
        variantId,
        sentQty,
      );
    }
    this.retryAttempt = 0;
    if (res.data.cart_token) {
      this.options.storage.write({
        token: res.data.cart_token,
        snapshot: res.data.cart,
        savedAt: this.now(),
      });
    }
    this.applyResponse(res.data, variantId);
    if (body.action !== "get") this.options.channel?.post();
    return "ok";
  }

  private withToken(body: CartRequestBody): CartRequestBody {
    if (this.state.identity.kind !== "guest" || body.action === "merge") return body;
    const token = this.token();
    return token ? ({ ...body, cart_token: token } as CartRequestBody) : body;
  }

  private applyResponse(data: CartResponse, variantId?: string): void {
    const retired = data.token_state === "retired";
    if (retired && this.state.identity.kind === "guest") this.options.storage.clear();
    const snapshot = retired ? null : data.cart;
    const server = Date.parse(data.server_time);
    const results = { ...this.state.results };
    if (variantId && isItemOutcome(data.outcome)) {
      if (data.outcome === "ok" || data.outcome === "removed") delete results[variantId];
      else
        results[variantId] = {
          outcome: data.outcome,
          requested: data.requested ?? 0,
          applied: data.applied ?? 0,
        };
    }
    // Cupón: un rechazo que no se guarda deja un aviso; poner o quitar uno con éxito lo borra.
    let coupon = this.state.coupon;
    if (data.outcome === "coupon_rejected" || data.outcome === "no_cart") {
      coupon = {
        ...coupon,
        notice: {
          code: this.lastCouponTyped,
          // Sin bolsa en el servidor (sesión vencida, bolsa ya fusionada) NO es un código malo: no se culpa al código.
          reason: data.outcome === "no_cart" ? "unavailable" : asCouponReason(data.reason),
          missing: typeof data.missing === "number" ? data.missing : null,
        },
      };
    } else if (data.outcome === "coupon_set" || data.outcome === "coupon_removed") {
      coupon = { ...coupon, notice: null };
    }
    this.set({
      snapshot,
      loaded: true,
      results,
      coupon,
      sync: { state: "idle" },
      ...(Number.isFinite(server) ? { clockOffsetMs: server - this.now() } : {}),
    });
    const mirrorToken = this.token();
    if (this.state.identity.kind === "guest" && mirrorToken) {
      this.options.storage.write({ token: mirrorToken, snapshot, savedAt: this.now() });
    }
  }

  private fail(
    res: Extract<FunctionResult<unknown>, { ok: false }>,
    variantId?: string,
    sentQty?: number,
  ): "hold" | "drop" {
    // Ningún fallo marca el carrito como «cargado»: si la primera lectura no llegó, la pantalla NO debe decir «tu bolsa
    // está vacía» (quien tiene 3 productos y está sin red los vería desaparecer), sino que no se pudo cargar.
    if (res.status === 0) {
      this.set({ sync: { state: "offline", code: "network" } });
      this.scheduleRetry();
      return "hold";
    }
    if (res.status === 429) {
      this.set({ sync: { state: "error", code: "rate_limited", retryAfter: res.retryAfter } });
      this.scheduleRetry((res.retryAfter ?? 30) * 1000);
      return "hold";
    }
    if (res.status === 401) {
      // Sesión vencida: lo pendiente se conserva por si la persona vuelve a entrar sin cambiar de cuenta.
      this.set({ sync: { state: "error", code: "session" } });
      return "hold";
    }
    if (res.status >= 500 || res.status === 408) {
      // Un error del servidor suele ser pasajero (arranque en frío, un reinicio): el cambio se CONSERVA y se reintenta con
      // espera creciente, hasta MAX_TRANSIENT_RETRIES veces seguidas. Si insiste, deja de reintentar solo pero NO descarta
      // nada: lo pendiente espera a que la persona pulse «Reintentar» (`retryNow`), que sí lo vuelve a enviar.
      this.set({ sync: { state: "error", code: res.code } });
      if (this.retryAttempt < MAX_TRANSIENT_RETRIES) this.scheduleRetry();
      return "hold";
    }
    // Error que un reintento no arregla (400, 413…): se descarta ESE cambio para no atascar la cola. Si la persona ya pidió
    // otra cantidad mientras volaba la petición, ese valor más nuevo se conserva.
    if (variantId && sentQty !== undefined && this.state.pending[variantId] === sentQty) {
      const { [variantId]: _bad, ...rest } = this.state.pending;
      void _bad;
      this.set({ pending: rest });
    }
    this.set({ sync: { state: "error", code: res.code } });
    return "drop";
  }

  private scheduleRetry(minMs = 0): void {
    this.cancelRetry();
    const wait = Math.max(minMs, Math.min(RETRY_BASE_MS * 2 ** this.retryAttempt, RETRY_MAX_MS));
    this.retryAttempt++;
    this.retryHandle = this.setTimer(() => {
      this.retryHandle = null;
      if (Object.keys(this.state.pending).length > 0) this.scheduleFlush();
      else void this.refetch();
    }, wait);
  }

  private cancelRetry(): void {
    if (this.retryHandle !== null) this.clearTimer(this.retryHandle);
    this.retryHandle = null;
  }
}
