# Sprint 4 — Sistema de UI / Design System

**Release:** R1 · **Estimación:** 4 días · **Depende de:** S0 (Tailwind/shadcn) + **entrega del diseño por la diseñadora** (externo, bloqueante parcial)

## Objetivo
Traducir el diseño de la diseñadora a un sistema de componentes reutilizable (tokens, tipografía, componentes, layouts), de modo que S5 y siguientes solo *compongan* pantallas.

## Alcance
**Dentro:** tokens de diseño (color, tipografía, espaciado, radios, sombras), tema, componentes base y de dominio sin datos reales (tarjeta de producto, selector de color/talla, galería, badges de stock, etc.), layouts del storefront (header, footer, menú móvil), guía visual (Storybook o página `/_ui`), accesibilidad, estados.
**Fuera:** pantallas con datos (S5+), contenido legal.

> **Bloqueo y plan B:** si el diseño llega tarde, se construye con **tokens provisionales** centralizados en un único archivo (`theme.css` + `tailwind.config`). Aplicar el diseño real = cambiar tokens y ajustar componentes, no reescribir pantallas. Este sprint puede ejecutarse **en paralelo** a S1–S3 en cuanto llegue el diseño.

## Reglas de negocio cubiertas
BR-ADM-05 (UX para nivel técnico bajo), lineamientos UI del maestro §9.

## Tareas

### Insumos de la diseñadora (checklist de entrega)
- [ ] Figma/archivo final con: logo (SVG), paleta, tipografías (licencia web), iconografía, grid, breakpoints.
- [ ] Pantallas: home, listado, detalle de producto, carrito, checkout, login/registro, cuenta, pedidos, 404/errores, emails (plantillas).
- [ ] Estados: hover, focus, disabled, error, vacío, carga, agotado, descuento.
- [ ] Versión móvil y escritorio de cada pantalla.
- [ ] Reglas de imágenes (proporción, recortes, tamaños).

### Tokens y base
- [ ] Variables CSS/Tailwind: colores (con modo claro; oscuro opcional), tipografía (escala), espaciado, radios, sombras, transiciones.
- [ ] Carga de fuentes optimizada (`font-display: swap`, subset, preload) y CSP actualizada.
- [ ] Iconos con `lucide-react` + set propio si la diseñadora lo trae.
- [ ] Soporte `prefers-reduced-motion`.

### Componentes (sobre shadcn/Radix)
- [ ] Primitivos: Button, Input, Select, Checkbox, Radio, Switch, Textarea, Dialog/Drawer (`vaul`), Sheet, Tabs, Accordion, Tooltip, Toast (`sonner`), Skeleton, Badge, Breadcrumb, Pagination, Carousel (`embla`).
- [ ] De dominio (presentacionales): `ProductCard`, `PriceTag` (precio, tachado, moneda), `StockBadge` (agotado/pocas unidades), `ColorSwatch`, `SizeSelector` (con deshabilitado por stock), `QuantityStepper`, `Gallery` (zoom, miniaturas, swipe), `EmptyState`, `ErrorState`, `FormField` con errores accesibles.
- [ ] Layouts: `Header` (logo, buscador, cuenta, carrito con contador), `MegaMenu`/menú móvil, `Footer`, `AnnouncementBar` (banner de noticias), `Container`/`Section`.
- [ ] Formularios: integración `react-hook-form` + `zod`, mensajes de error en español, máscaras (teléfono).
- [ ] Documentar todo en Storybook (o ruta `/_ui` solo en dev) con variantes y estados.
- [ ] **Reskin del panel admin** con los nuevos tokens (sin cambiar lógica de S3).

## Criterios de aceptación
1. Cada componente tiene todos sus estados documentados y se ve igual al diseño (revisión pixel-fina en 360/768/1280 px con la diseñadora).
2. Cambiar un token (p. ej. color primario) actualiza toda la UI.
3. Contraste mínimo **WCAG AA** en texto y controles; foco visible y navegación por teclado completa.
4. Lighthouse de la página de componentes: Accesibilidad ≥ 95.
5. El panel admin adopta la nueva identidad sin regresiones funcionales.

## Testing
- **Componentes (Testing Library):** render por variante/estado, accesibilidad por rol/etiqueta, eventos (selección de talla, stepper en límites).
- **Visual:** capturas Playwright/Storybook por breakpoint y comparación con baseline.
- **Accesibilidad automatizada:** `axe` en Storybook/E2E; revisión manual con teclado y lector de pantalla (VoiceOver).
- **Cross-browser:** Safari iOS, Chrome Android, Chrome/Firefox/Safari escritorio.
- **Rendimiento:** peso de CSS/fuentes, CLS al cargar fuentes e imágenes.

## Edge cases
- Nombres de producto muy largos / sin espacios; precios con muchos dígitos; moneda con símbolo ancho.
- Imágenes con proporciones inesperadas, rotas o lentas → *skeleton*/placeholder y `aspect-ratio` fijo.
- Colores de producto muy claros (blanco sobre blanco) → borde en `ColorSwatch`.
- Textos 30–40% más largos (traducciones futuras) sin romper layout.
- Zoom del navegador al 200% y tamaño de fuente del sistema aumentado.
- Notch/safe areas en iOS; teclado virtual tapando botones fijos.
- Modo oscuro del sistema si se decide soportarlo (decisión con la diseñadora).
- RTL no requerido; dejarlo documentado.
- Contador del carrito con 3+ dígitos; badges superpuestos.
- Falla de carga de fuentes → fallback sin saltos bruscos.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de diseño con la diseñadora (checklist de fidelidad firmado).
- [ ] Auditoría de dependencias de UI (peso, tree-shaking).
- [ ] Nombres de tokens y componentes consistentes y documentados.
- [ ] Sin estilos "mágicos" en pantallas: todo sale de tokens.

## Riesgos
- Diseño tardío o incompleto → tokens provisionales; no bloquear S5 (pantallas con estructura final, estilo ajustable).
- Divergencia entre Figma y shadcn → acordar con la diseñadora qué se adapta.

## Pendientes externos
Entrega de diseño, logo, tipografías y plantillas de email (diseñadora); decisión de modo oscuro.

## Entregables para sprints siguientes
Librería de componentes y layouts, tokens, guía visual, panel admin re-estilizado.
