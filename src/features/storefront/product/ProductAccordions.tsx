import type { ReactNode } from "react";
import { Droplets, Layers, MessageSquare, Truck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { t } from "@/i18n";

interface ProductAccordionsProps {
  materials: string | null;
  washcare: string | null;
  /** Textos de los ajustes públicos de la tienda; vacíos = el acordeón no se muestra. */
  shippingReturn: string | null;
  assistance: string | null;
}

const clean = (value: string | null) => (value && value.trim() !== "" ? value : null);

function Row({
  value,
  icon,
  title,
  text,
}: {
  value: string;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <AccordionItem value={value} className="border-foreground/70">
      {/* h2: en la ficha vienen justo después del h1 (un h3 saltaría de nivel) */}
      <AccordionTrigger asHeading="h2">
        <span className="flex items-center gap-3">
          <span aria-hidden="true">{icon}</span>
          {title}
        </span>
      </AccordionTrigger>
      {/* Texto plano: React lo escapa y `pre-line` respeta los saltos de línea del panel. NUNCA HTML. */}
      <AccordionContent className="whitespace-pre-line break-words">{text}</AccordionContent>
    </AccordionItem>
  );
}

/**
 * Acordeones del diseño («Envíos y devoluciones» con un camión y «Asistencia» con una burbuja, ambos con «+» a la
 * derecha), más «Materiales» y «Cuidados» cuando el producto los trae. Un acordeón sin texto no se pinta.
 */
export function ProductAccordions(props: ProductAccordionsProps) {
  const materials = clean(props.materials);
  const washcare = clean(props.washcare);
  const shipping = clean(props.shippingReturn);
  const assistance = clean(props.assistance);
  if (!materials && !washcare && !shipping && !assistance) return null;
  const icon = "h-[1.125rem] w-[1.125rem]";
  return (
    <Accordion type="multiple" className="border-t border-transparent">
      {materials && (
        <Row
          value="materials"
          icon={<Layers className={icon} strokeWidth={1.5} />}
          title={t("shop.product.accordion.materials")}
          text={materials}
        />
      )}
      {washcare && (
        <Row
          value="washcare"
          icon={<Droplets className={icon} strokeWidth={1.5} />}
          title={t("shop.product.accordion.washcare")}
          text={washcare}
        />
      )}
      {shipping && (
        <Row
          value="shipping"
          icon={<Truck className={icon} strokeWidth={1.5} />}
          title={t("shop.product.accordion.shipping")}
          text={shipping}
        />
      )}
      {assistance && (
        <Row
          value="assistance"
          icon={<MessageSquare className={icon} strokeWidth={1.5} />}
          title={t("shop.product.accordion.assistance")}
          text={assistance}
        />
      )}
    </Accordion>
  );
}
