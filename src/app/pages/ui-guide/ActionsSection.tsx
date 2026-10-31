import { ArrowRight, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Block, Specimen } from "./Block";

export function ActionsSection() {
  return (
    <Block
      id="botones"
      title="Botones y etiquetas"
      note="`caps` es el estilo de la tienda (mayúsculas con espaciado); el panel de administración usa texto normal."
    >
      <Specimen label="Variantes">
        <Button>Principal</Button>
        <Button variant="secondary">Secundario</Button>
        <Button variant="outline">Contorno</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="destructive">Eliminar</Button>
        <Button variant="link">Enlace</Button>
      </Specimen>
      <Specimen label="Estilo de la tienda (caps)">
        <Button caps size="lg">
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          Añadir a la bolsa
        </Button>
        <Button caps variant="outline" size="lg">
          Ver colección <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Specimen>
      <Specimen label="Tamaños">
        <Button size="sm">Pequeño</Button>
        <Button>Normal</Button>
        <Button size="lg">Grande</Button>
        <Button size="icon" aria-label="Añadir a la bolsa">
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Specimen>
      <Specimen label="Estados">
        <Button disabled>Desactivado</Button>
        <Button loading>Guardando…</Button>
        <Button variant="outline" disabled>
          Contorno desactivado
        </Button>
      </Specimen>
      <Specimen label="Etiquetas (Badge): el significado va en el texto, no solo en el color">
        <Badge>Borrador</Badge>
        <Badge tone="success">Publicado</Badge>
        <Badge tone="warning">Pocas unidades</Badge>
        <Badge tone="danger">Agotado</Badge>
        <Badge tone="info">En revisión</Badge>
        <Badge tone="solid" caps>
          Nuevo
        </Badge>
        <Badge tone="outline" caps>
          5 colores
        </Badge>
      </Specimen>
    </Block>
  );
}
