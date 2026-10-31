import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Pagination } from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Block, Specimen } from "./Block";

export function NavigationSection() {
  const [page, setPage] = useState(4);
  return (
    <Block id="navegacion" title="Navegación y contenido plegable">
      <Specimen label="Ruta de navegación">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Inicio</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/categoria/camisetas">Camisetas</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Camiseta oversize algodón pima</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Specimen>

      <Specimen label="Ruta de navegación con un nombre larguísimo sin espacios (no debe desbordar)">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Inicio</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                camiseta_oversize_algodon_pima_edicion_limitada_numerada_2026_color_terracota_talla_unica_envio_gratis
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </Specimen>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-2">
          <p className="eyebrow text-muted-foreground">Pestañas</p>
          <Tabs defaultValue="desc">
            <TabsList aria-label="Detalles del producto">
              <TabsTrigger value="desc">Descripción</TabsTrigger>
              <TabsTrigger value="mat">Materiales</TabsTrigger>
              <TabsTrigger value="care">Cuidados</TabsTrigger>
            </TabsList>
            <TabsContent value="desc" className="text-sm text-muted-foreground">
              Camiseta de corte holgado, ideal para el día a día.
            </TabsContent>
            <TabsContent value="mat" className="text-sm text-muted-foreground">
              100 % algodón pima peruano.
            </TabsContent>
            <TabsContent value="care" className="text-sm text-muted-foreground">
              Lavar a mano con agua fría, no usar lejía.
            </TabsContent>
          </Tabs>
        </div>
        <div className="space-y-2">
          <p className="eyebrow text-muted-foreground">Acordeón</p>
          <Accordion type="single" collapsible defaultValue="envios">
            <AccordionItem value="envios">
              <AccordionTrigger>Envíos</AccordionTrigger>
              <AccordionContent>Enviamos a toda Bolivia en 2 a 5 días hábiles.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="cambios">
              <AccordionTrigger>Cambios y devoluciones</AccordionTrigger>
              <AccordionContent>Tienes 7 días para cambiar tu compra.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <Specimen label={`Paginación (página ${page} de 12)`}>
        <Pagination page={page} totalPages={12} onPageChange={setPage} />
      </Specimen>
    </Block>
  );
}
