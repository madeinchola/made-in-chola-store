import { t } from "@/i18n";
import { charLength } from "../config/pgText";
import type {
  MethodCreateInput,
  MethodKind,
  MethodUpdateInput,
  ShippingMethod,
  StoreLocation,
} from "./types";

/** La misma regla de `shipping_methods.code`: `^[a-z][a-z0-9_]{1,31}$`. */
export const METHOD_CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;
/** El método base que crea la migración: sin él no hay envíos a domicilio. */
export const BASE_DELIVERY_CODE = "delivery";
export const MAX_METHOD_NAME = 80;
export const MAX_METHOD_DESCRIPTION = 300;
export const MIN_ETA_DAYS = 0;
export const MAX_ETA_DAYS = 90;

export const isBaseDeliveryMethod = (m: Pick<ShippingMethod, "code">): boolean =>
  m.code === BASE_DELIVERY_CODE;

export interface MethodFormValues {
  code: string;
  name: string;
  kind: MethodKind;
  description: string;
  /** Texto: vacío = sin plazo mínimo. */
  etaMinDays: string;
  etaMaxDays: string;
  /** "" = ninguna. Solo cuenta si `kind` es «pickup». */
  pickupLocationId: string;
  /** Texto: obligatorio (entero). */
  sortOrder: string;
  isActive: boolean;
}

export type MethodErrors = Partial<
  Record<
    | "code"
    | "name"
    | "description"
    | "pickupLocationId"
    | "etaMinDays"
    | "etaMaxDays"
    | "sortOrder",
    string
  >
>;

export const emptyMethodValues = (): MethodFormValues => ({
  code: "",
  name: "",
  kind: "delivery",
  description: "",
  etaMinDays: "",
  etaMaxDays: "",
  pickupLocationId: "",
  sortOrder: "0",
  isActive: true,
});

export const methodToValues = (m: ShippingMethod | null): MethodFormValues =>
  m
    ? {
        code: m.code,
        name: m.name,
        kind: m.kind,
        description: m.description ?? "",
        etaMinDays: m.etaMinDays === null ? "" : String(m.etaMinDays),
        etaMaxDays: m.etaMaxDays === null ? "" : String(m.etaMaxDays),
        pickupLocationId: m.pickupLocationId ?? "",
        sortOrder: String(m.sortOrder),
        isActive: m.isActive,
      }
    : emptyMethodValues();

/** Días enteros de 0 a 90, sin signo ni decimales. Vacío = sin valor (`null`); cualquier otra cosa = no válido. */
function parseEta(text: string): { ok: true; value: number | null } | { ok: false } {
  const s = text.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d{1,3}$/.test(s)) return { ok: false };
  const value = Number(s);
  return value >= MIN_ETA_DAYS && value <= MAX_ETA_DAYS ? { ok: true, value } : { ok: false };
}

/** Entero con signo de hasta 9 cifras (cabe de sobra en el `int` de Postgres). */
function parseOrder(text: string): number | null {
  const s = text.trim();
  if (!/^-?\d{1,9}$/.test(s)) return null;
  const value = Number(s);
  return value === 0 ? 0 : value; // evita -0
}

type CommonResult = { ok: true; input: MethodUpdateInput } | { ok: false; errors: MethodErrors };

/** Lo que se valida igual al crear y al editar: nombre, descripción, plazos, ubicación de recojo y orden. */
function validateCommon(values: MethodFormValues, errors: MethodErrors): CommonResult {
  const name = values.name.trim();
  if (name === "") errors.name = t("admin.shipping.store.methods.errors.nameRequired");
  else if (charLength(name) > MAX_METHOD_NAME)
    errors.name = t("admin.shipping.store.methods.errors.nameTooLong", { max: MAX_METHOD_NAME });

  const description = values.description.trim();
  if (charLength(description) > MAX_METHOD_DESCRIPTION)
    errors.description = t("admin.shipping.store.methods.errors.descriptionTooLong", {
      max: MAX_METHOD_DESCRIPTION,
    });

  const min = parseEta(values.etaMinDays);
  const max = parseEta(values.etaMaxDays);
  if (!min.ok) errors.etaMinDays = t("admin.shipping.store.methods.errors.etaInvalid");
  if (!max.ok) errors.etaMaxDays = t("admin.shipping.store.methods.errors.etaInvalid");
  const etaMin = min.ok ? min.value : null;
  const etaMax = max.ok ? max.value : null;
  if (etaMin !== null && etaMax !== null && etaMin > etaMax)
    errors.etaMaxDays = t("admin.shipping.store.methods.errors.etaOrder");

  // Un método «recojo» exige su ubicación; uno «domicilio» NO la lleva (lo exige la base: `shipping_methods_pickup_location`).
  const pickup = values.kind === "pickup" ? values.pickupLocationId.trim() : "";
  if (values.kind === "pickup" && pickup === "")
    errors.pickupLocationId = t("admin.shipping.store.methods.errors.pickupRequired");

  const sortOrder = parseOrder(values.sortOrder);
  if (sortOrder === null) errors.sortOrder = t("admin.shipping.store.methods.errors.orderInvalid");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name,
      description: description === "" ? null : description,
      etaMinDays: etaMin,
      etaMaxDays: etaMax,
      pickupLocationId: pickup === "" ? null : pickup,
      isActive: values.isActive,
      sortOrder: sortOrder as number,
    },
  };
}

export type MethodCreateValidation =
  { ok: true; input: MethodCreateInput } | { ok: false; errors: MethodErrors };
export type MethodUpdateValidation =
  { ok: true; input: MethodUpdateInput } | { ok: false; errors: MethodErrors };

/**
 * Alta de un método. El código (minúsculas, dígitos y guion bajo, 2–32, empieza con letra) no puede repetirse: se compara
 * con `existingCodes` (los de TODOS los métodos, también los archivados, porque la base los cuenta).
 */
export function validateMethodCreate(
  values: MethodFormValues,
  existingCodes: readonly string[],
): MethodCreateValidation {
  const errors: MethodErrors = {};
  const code = values.code.trim();
  if (code === "") errors.code = t("admin.shipping.store.methods.errors.codeRequired");
  else if (!METHOD_CODE_RE.test(code))
    errors.code = t("admin.shipping.store.methods.errors.codeFormat");
  else if (existingCodes.includes(code))
    errors.code = t("admin.shipping.store.methods.errors.codeTaken");

  const common = validateCommon(values, errors);
  if (!common.ok) return common;
  return { ok: true, input: { ...common.input, code, kind: values.kind } };
}

/** Edición: el código y el tipo no se tocan (el tipo que llega en `values` es el del método ya guardado). */
export function validateMethodUpdate(values: MethodFormValues): MethodUpdateValidation {
  return validateCommon(values, {});
}

/** El plazo estimado en una frase: «2–4 días», «El mismo día», «Hasta 3 días», «Sin plazo». */
export function etaLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return t("admin.shipping.store.methods.eta.none");
  if (min !== null && max !== null) {
    if (min === max) {
      if (min === 0) return t("admin.shipping.store.methods.eta.sameDay");
      return min === 1
        ? t("admin.shipping.store.methods.eta.exactOne")
        : t("admin.shipping.store.methods.eta.exact", { n: min });
    }
    return t("admin.shipping.store.methods.eta.range", { min, max });
  }
  if (min !== null)
    return min === 1
      ? t("admin.shipping.store.methods.eta.fromOne")
      : t("admin.shipping.store.methods.eta.from", { min });
  const upTo = max as number;
  return upTo === 1
    ? t("admin.shipping.store.methods.eta.upToOne")
    : t("admin.shipping.store.methods.eta.upTo", { max: upTo });
}

export type MethodStatus = "active" | "inactive" | "archived";

/** Archivado gana sobre inactivo. */
export const methodStatus = (m: Pick<ShippingMethod, "archived" | "isActive">): MethodStatus =>
  m.archived ? "archived" : m.isActive ? "active" : "inactive";

export interface PickupOption {
  id: string;
  name: string;
  /** Solo la ubicación que el método ya tiene y que dejó de estar disponible. */
  note: "inactive" | "archived" | "missing" | null;
}

/**
 * Ubicaciones que se ofrecen para el recojo: las ACTIVAS y sin archivar. Si el método ya apunta a una que dejó de estarlo
 * (o que ya no existe), se conserva como opción marcada, para que guardar otros cambios no la cambie en silencio.
 */
export function pickupOptions(
  locations: readonly StoreLocation[],
  currentId: string | null,
): PickupOption[] {
  const options: PickupOption[] = locations
    .filter((l) => l.isActive && !l.archived)
    .map((l) => ({ id: l.id, name: l.name, note: null }));
  if (currentId && !options.some((o) => o.id === currentId)) {
    const found = locations.find((l) => l.id === currentId);
    options.push(
      found
        ? { id: found.id, name: found.name, note: found.archived ? "archived" : "inactive" }
        : { id: currentId, name: "", note: "missing" },
    );
  }
  return options;
}

/** ¿Por qué un método de recojo vigente no se podría cotizar? (null = está bien o no aplica). */
export function pickupProblem(
  method: Pick<ShippingMethod, "kind" | "archived" | "pickupLocationId">,
  locations: readonly StoreLocation[],
): "inactive" | "archived" | "missing" | null {
  if (method.kind !== "pickup" || method.archived || method.pickupLocationId === null) return null;
  const location = locations.find((l) => l.id === method.pickupLocationId);
  if (!location) return "missing";
  if (location.archived) return "archived";
  return location.isActive ? null : "inactive";
}
