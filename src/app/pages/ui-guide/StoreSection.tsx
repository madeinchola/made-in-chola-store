import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/store/EmptyState";
import { ErrorState } from "@/components/store/ErrorState";
import { Gallery } from "@/components/store/Gallery";
import { PriceTag } from "@/components/store/PriceTag";
import { ProductCard } from "@/components/store/ProductCard";
import { QuantityStepper } from "@/components/store/QuantityStepper";
import { ColorSwatchGroup } from "@/components/store/ColorSwatch";
import { SizeSelector } from "@/components/store/SizeSelector";
import { StockBadge } from "@/components/store/StockBadge";
import type { ProductImage, ProductSummary } from "@/features/catalog/types";
import { money } from "@/lib/money";
import { Block, Specimen } from "./Block";

const base = {
  isNew: false,
  colorsCount: 3,
  soldOut: false,
  coverAlt: null,
  createdAt: "2026-10-01T00:00:00Z",
} as const;

// Las imágenes salen de Storage; en la guía las rutas son ficticias (sin red caen al marcador provisional y el E2E
// responde esas peticiones con imágenes generadas para ver el comportamiento real).
const PRODUCTS: ProductSummary[] = [
  {
    ...base,
    id: "p1",
    slug: "camiseta-oversize",
    name: "Camiseta oversize algodón pima",
    isNew: true,
    colorsCount: 5,
    price: money(18900, "BOB"),
    coverPath: "guia/camiseta.svg",
  },
  {
    ...base,
    id: "p2",
    slug: "chompa-alpaca",
    name: "Chompa de alpaca con cuello alto y botones de madera tallada a mano",
    colorsCount: 1,
    price: money(45000, "BOB"),
    coverPath: "guia/chompa.svg",
  },
  {
    ...base,
    id: "p3",
    slug: "pollera-agotada",
    name: "Pollera de gala",
    soldOut: true,
    price: money(120000, "BOB"),
    coverPath: "guia/pollera.svg",
  },
  {
    ...base,
    id: "p4",
    slug: "sin-imagen",
    name: "Sombrero_borsalino_artesanal_edicion_limitada_numerada",
    colorsCount: 0,
    price: money(123456789, "BOB"),
    coverPath: null,
  },
];

const IMAGES: ProductImage[] = [1, 2, 3].map((n) => ({
  id: `i${n}`,
  colorId: null,
  path: `guia/foto-${n}.svg`,
  alt: `Vista ${n} de la camiseta`,
  sortOrder: n,
}));

const COLORS = [
  { id: "c1", name: "Blanco", hex: "#FFFFFF" },
  { id: "c2", name: "Crema", hex: "#F5F0E6" },
  { id: "c3", name: "Terracota", hex: "#B5553A" },
  { id: "c4", name: "Negro", hex: "#1A1A1A", disabled: true },
  { id: "c5", name: "Sin definir", hex: null },
];

const SIZES = [
  { id: "s1", label: "S", status: "in_stock" as const },
  { id: "s2", label: "M", status: "low" as const },
  { id: "s3", label: "L", status: "out" as const },
  { id: "s4", label: "XL", status: "in_stock" as const },
];

export function StoreSection() {
  const [color, setColor] = useState("c1");
  const [size, setSize] = useState("s1");
  const [qty, setQty] = useState(1);
  const [qtyCapped, setQtyCapped] = useState(2);
  const [qtyBig, setQtyBig] = useState(124);
  return (
    <Block
      id="producto"
      title="Componentes de producto"
      note="Presentacionales: reciben datos por props. Las imágenes de la guía son provisionales (en el E2E se sirven imágenes generadas)."
    >
      <Specimen label="Tarjeta de producto: nuevo · nombre largo · agotado · sin imagen y precio enorme">
        <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
          {PRODUCTS.map((product, index) => (
            <li key={product.id}>
              <ProductCard product={product} headingAs="h3" priority={index === 0} />
            </li>
          ))}
        </ul>
      </Specimen>

      <Specimen label="Precio">
        <PriceTag price={money(18900, "BOB")} />
        <PriceTag price={money(18900, "BOB")} compareAt={money(24900, "BOB")} size="lg" />
        <PriceTag price={money(4900, "USD")} size="sm" />
        <PriceTag price={money(123456789, "BOB")} />
      </Specimen>

      <Specimen label="Disponibilidad">
        <StockBadge status="in_stock" />
        <StockBadge status="low" />
        <StockBadge status="out" />
      </Specimen>

      <div className="grid gap-8 md:grid-cols-2">
        <Specimen label="Color (el blanco y el crema llevan borde para distinguirse del fondo)">
          <ColorSwatchGroup options={COLORS} value={color} onValueChange={setColor} />
        </Specimen>
        <Specimen label="Talla (la agotada no se puede elegir)">
          <SizeSelector options={SIZES} value={size} onValueChange={setSize} />
        </Specimen>
      </div>

      <Specimen label="Cantidad: normal · con tope de 3 · 3 dígitos · desactivada">
        <QuantityStepper value={qty} onChange={setQty} />
        <QuantityStepper value={qtyCapped} onChange={setQtyCapped} max={3} />
        <QuantityStepper value={qtyBig} onChange={setQtyBig} />
        <QuantityStepper value={1} onChange={() => {}} disabled />
      </Specimen>

      <div className="space-y-2">
        <p className="eyebrow text-muted-foreground">Galería: miniaturas, deslizar y ampliar</p>
        <Gallery images={IMAGES} productName="Camiseta oversize" className="max-w-xl" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <EmptyState
          icon={PackageSearch}
          title="No encontramos productos"
          description="Prueba con otra categoría o quita algún filtro."
          action={<Button variant="outline">Ver todo</Button>}
        />
        <ErrorState onRetry={() => {}} />
      </div>
    </Block>
  );
}
