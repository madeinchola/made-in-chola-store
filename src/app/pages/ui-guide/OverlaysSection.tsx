import { Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Block, Specimen } from "./Block";

const SIDES = [
  ["right", "Cajón derecho"],
  ["left", "Cajón izquierdo"],
  ["top", "Cajón superior"],
  ["bottom", "Cajón inferior"],
] as const;

export function OverlaysSection() {
  return (
    <Block
      id="superposiciones"
      title="Diálogos, cajones, avisos y ayudas"
      note="Todos atrapan el foco, se cierran con Esc y devuelven el foco a quien los abrió. Las animaciones se desactivan con «reducir movimiento»."
    >
      <Specimen label="Diálogo">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Abrir diálogo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Vaciar la bolsa?</DialogTitle>
              <DialogDescription>Se quitarán los 3 productos que agregaste.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancelar</Button>
              <Button variant="destructive">Vaciar bolsa</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Specimen>

      <Specimen label="Cajones (Sheet)">
        {SIDES.map(([side, label]) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="outline">{label}</Button>
            </SheetTrigger>
            <SheetContent side={side} bodyClassName="p-6">
              <SheetHeader className="space-y-1.5">
                <SheetTitle>{label}</SheetTitle>
                <SheetDescription>Carrito, menú móvil, filtros o buscador.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        ))}
      </Specimen>

      <Specimen label="Avisos (toast)">
        <Button variant="outline" onClick={() => toast.success("Producto guardado")}>
          Éxito
        </Button>
        <Button variant="outline" onClick={() => toast.error("No pudimos guardar")}>
          Error
        </Button>
        <Button variant="outline" onClick={() => toast.warning("Quedan pocas unidades")}>
          Advertencia
        </Button>
        <Button variant="outline" onClick={() => toast.info("Envíos de lunes a sábado")}>
          Información
        </Button>
      </Specimen>

      <Specimen label="Ayuda emergente (solo complementaria: no aparece al tocar)">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Información sobre las tallas">
              <Info className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mide el contorno del pecho</TooltipContent>
        </Tooltip>
      </Specimen>
    </Block>
  );
}
