import { z } from "https://esm.sh/zod@3.25.76";

/**
 * Lógica pura de la función `cart` (sin red ni base): el formato del token anónimo, el esquema de las peticiones y qué
 * función SQL corresponde a cada una. Así se prueba entera con Deno sin levantar nada.
 */

/** Token opaco del carrito de un invitado: «ct_» + 32 bytes aleatorios en base64url (43 caracteres). */
export const CART_TOKEN_PATTERN = /^ct_[A-Za-z0-9_-]{43}$/;

/** Tope del cuerpo de una petición: ninguna acción necesita más (todas son valores sueltos, sin listas). */
export const MAX_BODY_BYTES = 2048;

/** Topes de tasa (D-02): ventana en segundos. Leer es barato; escribir retiene stock, así que va más apretado. */
export const LIMITS = {
  // Las redes de operadora móvil comparten una IP entre muchísima gente: los topes por IP son generosos y lo que de verdad
  // acota el acaparamiento es el tope de unidades retenidas por red (`cart_max_units_per_ip`, en la base).
  anyPerIp: { max: 600, windowSeconds: 60 },
  writePerIdentity: { max: 60, windowSeconds: 60 },
  writePerIp: { max: 300, windowSeconds: 60 },
  /** Carritos de invitado NUEVOS por red (IPv4 o /64): quien quisiera acaparar stock tendría que abrir muchos. */
  newCartPerIp: { max: 30, windowSeconds: 3600 },
  mergePerUser: { max: 20, windowSeconds: 600 },
} as const;

export function generateCartToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "ct_" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isCartToken(value: unknown): value is string {
  return typeof value === "string" && CART_TOKEN_PATTERN.test(value);
}

/** sha256 en hexadecimal: la base solo guarda esto, nunca el token. */
export async function hashCartToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const uuid = z.string().uuid();
// El formato del token se valida aparte (400 con un mensaje claro), no con regex en el esquema.
const token = z.string().max(64);

// Solo valores escalares y `.strict()`: nada de listas (aviso de zod) ni campos de más.
export const cartRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), cart_token: token.optional() }).strict(),
  z
    .object({
      action: z.literal("set_item"),
      variant_id: uuid,
      qty: z.number().int().min(0).max(1000),
      cart_token: token.optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("remove_item"), variant_id: uuid, cart_token: token.optional() })
    .strict(),
  z.object({ action: z.literal("clear"), cart_token: token.optional() }).strict(),
  z.object({ action: z.literal("refresh"), cart_token: token.optional() }).strict(),
  z
    .object({
      action: z.literal("accept_prices"),
      variant_id: uuid.optional(),
      // El precio que la persona VIO: si ya cambió, no se acepta nada (solo con `variant_id`).
      expected_price: z.number().positive().max(1_000_000_000).optional(),
      cart_token: token.optional(),
    })
    .strict(),
  z.object({ action: z.literal("merge"), cart_token: token }).strict(),
]);
export type CartRequest = z.infer<typeof cartRequestSchema>;

export interface CartIdentity {
  /** Usuario autenticado, o null si es un invitado. */
  userId: string | null;
  /** sha256 del token del invitado; en `merge` acompaña al usuario. */
  tokenHash: string | null;
  /**
   * El invitado solo puede ESTRENAR carrito con un token que el servidor acaba de emitir en esta petición. Un token que
   * trae el cliente y la base no conoce se rechaza (token_retired): si no, bastaría inventar tokens para saltarse el
   * tope de carritos nuevos por IP.
   */
  mayCreate: boolean;
  /** Huella de la red del invitado (HMAC), o null. Solo se guarda al estrenar su carrito. */
  ipHash: string | null;
}

export interface RpcPlan {
  fn: string;
  args: Record<string, unknown>;
}

/** Qué función SQL ejecuta cada acción. El usuario autenticado manda sobre el token (salvo en `merge`). */
export function planRpc(request: CartRequest, identity: CartIdentity): RpcPlan {
  const owner = {
    p_profile_id: identity.userId,
    p_token_hash: identity.userId ? null : identity.tokenHash,
  };
  switch (request.action) {
    case "get":
      return { fn: "cart_get", args: owner };
    case "set_item":
      return {
        fn: "cart_set_item",
        args: {
          ...owner,
          p_variant_id: request.variant_id,
          p_qty: request.qty,
          p_may_create: identity.userId ? true : identity.mayCreate,
          p_ip_hash: identity.userId ? null : identity.ipHash,
        },
      };
    case "remove_item":
      return { fn: "cart_remove_item", args: { ...owner, p_variant_id: request.variant_id } };
    case "clear":
      return { fn: "cart_clear", args: owner };
    case "refresh":
      return { fn: "cart_refresh", args: owner };
    case "accept_prices":
      return {
        fn: "cart_accept_prices",
        args: {
          ...owner,
          p_variant_id: request.variant_id ?? null,
          p_expected_price: request.expected_price ?? null,
        },
      };
    case "merge":
      return {
        fn: "merge_guest_cart",
        args: { p_profile_id: identity.userId, p_token_hash: identity.tokenHash },
      };
  }
}

/** ¿La acción cambia algo (retiene o libera stock)? Las de escritura tienen topes más apretados. */
export function isWrite(request: CartRequest): boolean {
  return request.action !== "get";
}
