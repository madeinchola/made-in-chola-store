import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ProductRow } from "@/components/store/ProductRow";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { contactLinks } from "@/components/layout/contactLinks";
import type { ProductDetail, StoreSettings } from "@/features/catalog/types";
import { t } from "@/i18n";
import { formatMoney, toDecimalString } from "@/lib/money";
import { usePrefetchProduct } from "../hooks";
import { track } from "../analytics/track";
import { canonicalUrl } from "../seo/canonical";
import { siteUrl } from "../seo/siteUrl";
import { usePageMeta } from "../seo/usePageMeta";
import { ColorBars } from "./ColorBars";
import { ProductAccordions } from "./ProductAccordions";
import { ProductMedia } from "./ProductMedia";
import { PurchaseButton } from "./PurchaseButton";
import { SizePicker } from "./SizePicker";
import { imagesForColor } from "./productImages";
import { buildProductSeo } from "./productSeo";
import { storeRoutesForProduct } from "./routes";
import {
  colorOptions,
  hasSizes,
  keepSizeAfterColorChange,
  reconcileSize,
  resolveColorId,
  selectionState,
  sizeOptions,
} from "./variantSelection";
import { whatsappHref, whatsappMessage } from "./whatsapp";

const text = (settings: StoreSettings | undefined, key: string): string | null => {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
};

interface ProductViewProps {
  detail: ProductDetail;
  slug: string;
  settings: StoreSettings | undefined;
}

/**
 * Ficha de producto con datos ya cargados. El color vive en la URL (`?color=negro`: el enlace compartido lo conserva)
 * y la talla en el estado; ambos se validan SIEMPRE contra el stock público, así que ni la URL ni el estado pueden
 * dejar elegida una combinación que no existe o está agotada. Se monta con `key` por producto: al cambiar de producto
 * la talla vuelve a empezar.
 */
export function ProductView({ detail, slug, settings }: ProductViewProps) {
  const { product } = detail;
  const [searchParams, setSearchParams] = useSearchParams();
  const [rawSize, setRawSize] = useState<string | null>(null);
  const prefetch = usePrefetchProduct();

  const colors = useMemo(() => colorOptions(detail), [detail]);
  const colorId = resolveColorId(detail, searchParams.get("color"));
  const sizeId = reconcileSize(detail, colorId, rawSize);
  const selection = selectionState(detail, colorId, sizeId);
  const sizes = sizeOptions(detail, colorId);
  const color = colors.find((c) => c.id === colorId) ?? null;
  const size = sizes.find((s) => s.id === sizeId) ?? null;
  const images = useMemo(() => imagesForColor(detail.images, colorId), [detail.images, colorId]);

  const brand = text(settings, "business_name") ?? "Made In Chola";
  const url = canonicalUrl(siteUrl(), storeRoutesForProduct.product(slug));
  const meta = useMemo(
    () => buildProductSeo({ detail, slug, siteUrl: siteUrl(), brand }),
    [detail, slug, brand],
  );
  usePageMeta(meta);

  useEffect(() => {
    track({
      name: "view_item",
      item: {
        id: product.id,
        name: product.name,
        price: Number(toDecimalString(product.price)),
        currency: product.price.currency,
      },
    });
  }, [product.id, product.name, product.price]);

  const pickColor = (id: string) => {
    const picked = colors.find((c) => c.id === id);
    if (!picked) return;
    setRawSize((current) => keepSizeAfterColorChange(detail, id, current));
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("color", picked.slug);
        return next;
      },
      { replace: true },
    );
  };

  const href =
    selection.state === "ready"
      ? whatsappHref(
          contactLinks(settings).whatsapp?.href,
          whatsappMessage({
            name: product.name,
            price: formatMoney(product.price),
            color: color && colors.length > 1 ? color.name : null,
            size: size?.label ?? null,
            url,
          }),
        )
      : null;

  return (
    <article className="px-[2vw] pb-20 lg:pr-[8.1vw]">
      <div className="grid gap-x-[7vw] gap-y-8 pt-4 lg:grid-cols-[minmax(0,1.17fr)_minmax(0,1fr)]">
        <ProductMedia images={images} productName={product.name} colorId={colorId} />

        <div className="min-w-0 space-y-7 lg:sticky lg:top-6 lg:mt-12 lg:self-start">
          <Breadcrumb label={t("shop.product.breadcrumb.label")}>
            <BreadcrumbList className="text-xs">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={storeRoutesForProduct.home}>{t("nav.home")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={storeRoutesForProduct.shop}>{t("shop.product.breadcrumb.shop")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{product.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="space-y-2">
            <h1 className="break-words font-display text-display-md leading-tight">
              {product.name}
            </h1>
            <p className="flex flex-wrap items-center gap-3 text-lg tabular-nums">
              <span>{formatMoney(product.price)}</span>
              {selection.status === "low" && <Badge tone="warning">{t("shop.product.low")}</Badge>}
              {selection.state === "sold_out" && (
                <Badge tone="danger">{t("shop.product.soldOut")}</Badge>
              )}
            </p>
            {product.model && (
              <p className="eyebrow text-muted-foreground">
                {t("shop.product.model", { model: product.model })}
              </p>
            )}
          </div>

          {color && (
            <div className="space-y-3">
              <p className="eyebrow">{t("shop.product.color", { name: color.name })}</p>
              {colors.length > 1 && (
                <ColorBars options={colors} value={colorId} onChange={pickColor} />
              )}
            </div>
          )}

          {hasSizes(detail) && <SizePicker options={sizes} value={sizeId} onChange={setRawSize} />}

          <div>
            <PurchaseButton state={selection.state} whatsappHref={href} />
          </div>

          {product.description.trim() !== "" && (
            // Texto plano con `pre-line`: respeta saltos de línea y emojis; React lo escapa (nunca HTML).
            <p className="whitespace-pre-line break-words text-justify text-sm leading-[1.4] text-muted-foreground [hyphens:auto]">
              {product.description}
            </p>
          )}

          <ProductAccordions
            materials={product.materials}
            washcare={product.washcare}
            shippingReturn={text(settings, "pdp_shipping_return_text")}
            assistance={text(settings, "pdp_assistance_text")}
          />
        </div>
      </div>

      <ProductRow
        title={t("shop.product.related")}
        products={detail.related}
        headingAs="h2"
        onPrefetch={prefetch}
        className="mt-20"
      />
    </article>
  );
}
