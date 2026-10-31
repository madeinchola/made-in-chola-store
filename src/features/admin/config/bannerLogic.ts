import { t } from "@/i18n";
import { fromLaPazInputValue } from "@/lib/datetime";
import { charLength, isSafeLink } from "./pgText";

export type BannerStatus = "live" | "scheduled" | "expired" | "inactive" | "archived";

export interface BannerLike {
  isActive: boolean;
  archived: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * Estado de un banner con las MISMAS reglas que la vista `public_news_banners`: se ve si no está archivado, está activo,
 * ya empezó (`starts_at <= ahora`) y no terminó (`ends_at > ahora`). Precedencia: archivado, inactivo, programado, vencido.
 */
export function bannerStatus(b: BannerLike, now: Date): BannerStatus {
  if (b.archived) return "archived";
  if (!b.isActive) return "inactive";
  const t0 = now.getTime();
  if (b.startsAt !== null && new Date(b.startsAt).getTime() > t0) return "scheduled";
  if (b.endsAt !== null && new Date(b.endsAt).getTime() <= t0) return "expired";
  return "live";
}

export interface BannerOrderable extends BannerLike {
  id: string;
  createdAt: string;
}

/**
 * Cuál de los banners vigentes muestra la tienda: la vista los ordena por `starts_at desc nulls last, created_at desc` y el
 * front toma el primero (`limit 1`). Si no hay ninguno vigente devuelve null.
 */
export function shownBannerId(banners: readonly BannerOrderable[], now: Date): string | null {
  const live = banners.filter((b) => bannerStatus(b, now) === "live");
  live.sort((a, b) => {
    if (a.startsAt !== b.startsAt) {
      if (a.startsAt === null) return 1;
      if (b.startsAt === null) return -1;
      return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return live[0]?.id ?? null;
}

export interface BannerFormValues {
  message: string;
  linkUrl: string;
  /** Valor de `datetime-local` en hora de La Paz ("" = sin fecha). */
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface BannerPayload {
  message: string;
  link_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export type BannerErrors = Partial<Record<"message" | "linkUrl" | "startsAt" | "endsAt", string>>;

export const MAX_BANNER_MESSAGE = 200;

/** Valida el formulario con las restricciones de `news_banners` (mensaje 1–200, enlace seguro, fin posterior al inicio). */
export function validateBanner(
  values: BannerFormValues,
): { ok: true; payload: BannerPayload } | { ok: false; errors: BannerErrors } {
  const errors: BannerErrors = {};
  const message = values.message.trim();
  if (message === "") errors.message = t("admin.config.banners.errors.messageRequired");
  else if (charLength(message) > MAX_BANNER_MESSAGE)
    errors.message = t("admin.config.banners.errors.messageTooLong", { max: MAX_BANNER_MESSAGE });

  const link = values.linkUrl.trim();
  if (link !== "" && !isSafeLink(link)) errors.linkUrl = t("admin.config.banners.errors.link");

  let startsAt: string | null = null;
  let endsAt: string | null = null;
  try {
    startsAt = fromLaPazInputValue(values.startsAt);
  } catch {
    errors.startsAt = t("admin.config.banners.errors.date");
  }
  try {
    endsAt = fromLaPazInputValue(values.endsAt);
  } catch {
    errors.endsAt = t("admin.config.banners.errors.date");
  }
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    errors.endsAt = t("admin.config.banners.errors.window");
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      message,
      link_url: link === "" ? null : link,
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: values.isActive,
    },
  };
}
