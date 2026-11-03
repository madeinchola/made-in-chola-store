import { z } from "zod";
import { EMPTY_PIN, parsePin, toPinText, type CoordinateProblem } from "@/components/map/coords";
import { t, type MessageKey } from "@/i18n";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { DIAL_CODES, normalizePhone } from "@shared/identity";
import { splitPhone } from "./phone";
import type { Address, AddressInput } from "./types";

/** Largos máximos: los mismos CHECK de la tabla `addresses` (`char_length`, es decir, en CARACTERES, no en bytes). */
export const FIELD_LIMITS = {
  label: 40,
  recipient: 120,
  line1: 200,
  line2: 200,
  city: 80,
  department: 80,
  referenceText: 300,
} as const;

export const BOLIVIA_DEPARTMENTS = [
  "La Paz",
  "Cochabamba",
  "Santa Cruz",
  "Oruro",
  "Potosí",
  "Chuquisaca",
  "Tarija",
  "Beni",
  "Pando",
] as const;
export type BoliviaDepartment = (typeof BOLIVIA_DEPARTMENTS)[number];
const BOLIVIA = "BO";

/** Sin tildes (marcas combinantes Unicode), sin espacios en los extremos y en minúsculas. */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** El departamento de la lista que corresponde al texto (sin distinguir mayúsculas ni tildes), o null. */
export function canonicalDepartment(value: string): BoliviaDepartment | null {
  const wanted = fold(value);
  return BOLIVIA_DEPARTMENTS.find((d) => fold(d) === wanted) ?? null;
}

/**
 * Largo como lo cuenta la base (`char_length`: puntos de código). `string.length` cuenta unidades UTF-16 y un emoji vale 2:
 * con él, una etiqueta de 21 emojis se rechazaría aunque la base la acepta.
 */
export const charLength = (value: string) => Array.from(value).length;

function text(max: number, messages: { required?: string; tooLong: string }) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const length = charLength(value);
      if (length === 0) {
        if (messages.required)
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.required });
      } else if (length > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.tooLong });
      }
    });
}

const COUNTRY_CODE = /^[A-Z]{2}$/;

const pinMessage = (axis: "lat" | "lng", problem: CoordinateProblem): string => {
  if (problem === "missing") {
    return t(
      axis === "lat"
        ? "acct.addresses.errors.pinLatMissing"
        : "acct.addresses.errors.pinLngMissing",
    );
  }
  if (problem === "format") return t("acct.addresses.errors.pinFormat");
  return t(
    axis === "lat" ? "acct.addresses.errors.pinLatRange" : "acct.addresses.errors.pinLngRange",
  );
};

export interface AddressSchemaOptions {
  /** Códigos de país habilitados (de `public_countries`). Sin esta lista solo se exige que sea un código ISO-2. */
  allowedCountries?: readonly string[] | undefined;
}

/** Esquema del formulario de dirección. Los mensajes van en español junto al campo (`path` de cada problema). */
export function createAddressSchema({ allowedCountries }: AddressSchemaOptions = {}) {
  return z
    .object({
      label: text(FIELD_LIMITS.label, {
        required: t("acct.addresses.errors.labelRequired"),
        tooLong: t("acct.addresses.errors.labelTooLong", { max: FIELD_LIMITS.label }),
      }),
      recipient: text(FIELD_LIMITS.recipient, {
        required: t("acct.addresses.errors.recipientRequired"),
        tooLong: t("acct.addresses.errors.recipientTooLong", { max: FIELD_LIMITS.recipient }),
      }),
      /** País del PREFIJO del teléfono (independiente del país de la dirección). */
      phoneCountry: z.string(),
      /** Número nacional (con o sin máscara) o internacional con «+». */
      phone: z.string(),
      country: z.string().trim(),
      department: z.string().trim(),
      city: text(FIELD_LIMITS.city, {
        required: t("acct.addresses.errors.cityRequired"),
        tooLong: t("acct.addresses.errors.cityTooLong", { max: FIELD_LIMITS.city }),
      }),
      line1: text(FIELD_LIMITS.line1, {
        required: t("acct.addresses.errors.line1Required"),
        tooLong: t("acct.addresses.errors.line1TooLong", { max: FIELD_LIMITS.line1 }),
      }),
      line2: text(FIELD_LIMITS.line2, {
        tooLong: t("acct.addresses.errors.line2TooLong", { max: FIELD_LIMITS.line2 }),
      }),
      referenceText: text(FIELD_LIMITS.referenceText, {
        tooLong: t("acct.addresses.errors.referenceTooLong", { max: FIELD_LIMITS.referenceText }),
      }),
      /** Latitud y longitud como texto: ambas vacías (sin pin) o ambas válidas. */
      lat: z.string(),
      lng: z.string(),
      forShipping: z.boolean(),
      forBilling: z.boolean(),
      isDefault: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

      // País de la dirección.
      if (
        !COUNTRY_CODE.test(v.country) ||
        (allowedCountries && !allowedCountries.includes(v.country))
      ) {
        issue("country", t("acct.addresses.errors.countryInvalid"));
      }

      // Departamento: lista cerrada en Bolivia; texto libre (opcional) en otro país.
      if (v.country === BOLIVIA) {
        if (v.department === "") issue("department", t("acct.addresses.errors.departmentRequired"));
        else if (!canonicalDepartment(v.department)) {
          issue("department", t("acct.addresses.errors.departmentInvalid"));
        }
      } else if (charLength(v.department) > FIELD_LIMITS.department) {
        issue(
          "department",
          t("acct.addresses.errors.departmentTooLong", { max: FIELD_LIMITS.department }),
        );
      }

      // Teléfono: se valida con la MISMA función que lo normaliza al guardar (E.164).
      if (!Object.hasOwn(DIAL_CODES, v.phoneCountry)) {
        issue("phoneCountry", t("acct.addresses.errors.phoneCountryInvalid"));
      } else {
        const phone = normalizePhone(v.phone, v.phoneCountry);
        if (!phone.ok) issue("phone", t(`auth.phone.${phone.reason}` as MessageKey));
      }

      // Pin: todo o nada.
      const pin = parsePin({ lat: v.lat, lng: v.lng });
      if (pin.kind === "invalid") {
        if (pin.lat) issue("lat", pinMessage("lat", pin.lat));
        if (pin.lng) issue("lng", pinMessage("lng", pin.lng));
      }

      // Al menos un uso.
      if (!v.forShipping && !v.forBilling) {
        issue("forShipping", t("acct.addresses.errors.purposeNone"));
      }
    });
}

export const addressFormSchema = createAddressSchema();
export type AddressFormValues = z.infer<typeof addressFormSchema>;

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * Valores YA validados → lo que se envía a la base: textos recortados, opcionales vacíos como null, teléfono en E.164 y
 * pin como números (o null/null). Lanza si se llama con datos sin validar (error de programación).
 */
export function toAddressInput(values: AddressFormValues): AddressInput {
  const phone = normalizePhone(values.phone, values.phoneCountry);
  if (!phone.ok) throw new Error("toAddressInput: teléfono sin validar");
  const pin = parsePin({ lat: values.lat, lng: values.lng });
  if (pin.kind === "invalid") throw new Error("toAddressInput: pin sin validar");
  const country = values.country.trim();
  const department =
    country === BOLIVIA
      ? (canonicalDepartment(values.department) ?? emptyToNull(values.department))
      : emptyToNull(values.department);
  return {
    label: values.label.trim(),
    recipient: values.recipient.trim(),
    phoneE164: phone.e164,
    line1: values.line1.trim(),
    line2: emptyToNull(values.line2),
    city: values.city.trim(),
    department,
    country,
    referenceText: emptyToNull(values.referenceText),
    lat: pin.kind === "pin" ? pin.lat : null,
    lng: pin.kind === "pin" ? pin.lng : null,
    forShipping: values.forShipping,
    forBilling: values.forBilling,
    isDefault: values.isDefault,
  };
}

export interface FormDefaults {
  /** Nombre del perfil: destinatario por defecto al crear. */
  recipient: string;
  /** Teléfono del perfil (E.164), si lo tiene: se ofrece como contacto al crear. */
  phone: string | null;
  /** País de la dirección al crear (el primero habilitado, normalmente Bolivia). */
  country: string;
}

/** Valores iniciales del formulario: los de la dirección al editar, o los del perfil al crear. */
export function addressToFormValues(
  address: Address | null,
  defaults: FormDefaults,
): AddressFormValues {
  const phone = splitPhone(address?.phone ?? defaults.phone ?? "");
  const hasPhone = Boolean(address?.phone ?? defaults.phone);
  const country = address?.country ?? defaults.country ?? DEFAULT_COUNTRY;
  const department = address?.department ?? "";
  const pin =
    address && address.lat !== null && address.lng !== null
      ? toPinText({ lat: address.lat, lng: address.lng })
      : EMPTY_PIN;
  return {
    label: address?.label ?? "",
    recipient: address?.recipient ?? defaults.recipient,
    phoneCountry: hasPhone ? phone.country : DEFAULT_COUNTRY,
    phone: hasPhone ? phone.national : "",
    country,
    department: country === BOLIVIA ? (canonicalDepartment(department) ?? "") : department,
    city: address?.city ?? "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    referenceText: address?.referenceText ?? "",
    lat: pin.lat,
    lng: pin.lng,
    forShipping: address?.forShipping ?? true,
    forBilling: address?.forBilling ?? false,
    isDefault: false,
  };
}
