import { ImageOff } from "lucide-react";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { productImageUrl } from "@/features/catalog/mediaUrl";
import { formatMoney, fromDecimal } from "@/lib/money";
import { SectionCard } from "../../ui/PageHeader";
import { coverImage } from "./coverImage";
import type { AdminProductDetail } from "../types";

/** Vista previa aproximada del producto GUARDADO (el diseño final de la tienda llega después). */
export function PreviewSection({ detail }: { detail: AdminProductDetail }) {
  const p = detail.product;
  const bob = detail.prices.find((x) => x.currency === "BOB" && x.country === null);
  const cover = coverImage(detail.images, detail.colors);
  const activeColors = detail.colors.filter((c) => !c.archived);
  const activeVariants = detail.variants.filter(
    (v) => !v.archived && activeColors.some((c) => c.id === v.colorId),
  );
  const soldOut = activeVariants.length > 0 && activeVariants.every((v) => v.available <= 0);

  return (
    <SectionCard
      id="sec-preview"
      title={t("admin.products.edit.sections.preview")}
      description={t("admin.products.preview.note")}
    >
      <div className="max-w-xs">
        <div className="relative">
          {cover ? (
            <img
              src={productImageUrl(cover.path)}
              alt={cover.alt ?? p.name}
              className="aspect-[4/5] w-full rounded object-cover"
            />
          ) : (
            <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded bg-muted text-muted-foreground">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <span className="text-sm">{t("admin.products.preview.noImage")}</span>
            </div>
          )}
          <div className="absolute left-2 top-2 flex gap-1">
            {p.isNew && <Badge tone="info">{t("admin.products.preview.newBadge")}</Badge>}
            {soldOut && <Badge tone="danger">{t("admin.products.preview.soldOut")}</Badge>}
          </div>
        </div>
        <h3 className="mt-3 font-display text-lg font-semibold">{p.name}</h3>
        <p className="text-sm">
          {bob ? formatMoney(fromDecimal(bob.amount, "BOB")) : t("admin.products.list.noPrice")}
        </p>
        {activeColors.length > 0 && (
          <ul
            className="mt-2 flex flex-wrap items-center gap-1.5"
            aria-label={t("admin.products.preview.colors", { count: activeColors.length })}
          >
            {activeColors.map((c) => (
              <li key={c.id} title={c.name}>
                <span
                  className="block h-5 w-5 rounded-full border"
                  style={c.hex ? { backgroundColor: c.hex } : undefined}
                >
                  <span className="sr-only">{c.name}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {p.description && (
          <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{p.description}</p>
        )}
      </div>
    </SectionCard>
  );
}
