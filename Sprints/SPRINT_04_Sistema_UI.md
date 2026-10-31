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

---

## Estado real de entrega (2026-10-30)

**Entregado:** sistema de tokens (`src/styles/tokens.css` + `tailwind.config.ts`: color, tipografía fluida, radios, sombras, movimiento, medidas, superficie invertida `.theme-inverse`); fuentes provisionales autoalojadas con métricas de respaldo y precarga; primitivas nuevas (Checkbox, RadioGroup, Switch, Tabs, Accordion, Tooltip, Sheet, Skeleton, Breadcrumb, Pagination, Carousel, Toaster con tokens) y `Button`/`Badge`/`Dialog` rediseñados; componentes de producto (`ProductCard`, `PriceTag`, `StockBadge`, `ColorSwatch(Group)`, `SizeSelector`, `QuantityStepper`, `Gallery`, `EmptyState`, `ErrorState`); layouts (`Header`, `MegaMenu`, `MobileMenu`, `SearchSheet`, `CartLink`, `Footer`, `AnnouncementBar`, `Container`, `Section`) integrados en `PublicLayout`; guía `/_ui` (solo dev/E2E); panel de administración con la nueva identidad (colores crudos → tokens, migas con la primitiva compartida); mensajes de zod en español y máscara de teléfono.

**Cabecera y pie fieles al PDF (2026-10-31):** tras revisar el PDF de Inicio a 1366 px se rehicieron para que coincidan: cabecera de 130 px (transparente y blanca sobre el hero en la portada; sólida con línea inferior en las demás páginas), logotipo «MADE IN CHOLA» disperso en tres filas, «Tienda ⌄ · Nosotros» a la izquierda y «Bolivia ⌄ · bolsa (0) · usuario · lupa» a la derecha; pie marrón con el símbolo de la marca, cuatro columnas con título serif subrayado (Índice del sitio · Síguenos · Contáctanos · Legal) y fila inferior con Copyright y enlaces legales. Un E2E (`e2e/layout.spec.ts`) mide posiciones y alturas contra el PDF. Consecuencia: las acciones de sesión pasaron a un único icono de usuario con menú (Mi cuenta · Panel · Cerrar sesión); se adaptaron los tests de auth/admin. Desviaciones deliberadas: degradado oscuro tenue tras la cabecera de portada y texto atenuado del pie más claro (contraste AA), tamaños de letra mínimos de 12 px (el PDF usa ~10 px), «Developed by VNS» y el bloque «10 % OFF» no se incluyen, el símbolo del pie y el logotipo son aproximaciones PROVISIONALES hasta recibir los SVG.

**Desviaciones respecto al plan (y por qué):**
- **Fuentes**: Baskervville + Jost (OFL) en lugar de Baskerville + Intelo: la licencia web de las originales no está confirmada. Cambio de un solo sitio.
- **Contraste**: texto atenuado y borde de campos más oscuros que en el PDF para cumplir WCAG AA (tests lo vigilan).
- **Sin modo oscuro** (opcional; no hay diseño). **Sin `vaul`**: el cajón inferior es `Sheet side="bottom"` sobre Radix Dialog (sin arrastrar para cerrar). **Sin Storybook**: `/_ui`.
- **Imágenes de los PDF no usadas** (directriz del dueño): marcador provisional.
- **MegaMenu**: un único botón «Tienda» con todas las categorías en columnas (como el «SHOP ⌄» del PDF). **Pie**: marca, categorías, redes y contacto (sin boletín ni cupón; sin columnas de Ayuda/Legal hasta S15).
- **Búsqueda sin ruta** (campo desactivado, «próximamente») y **`/carrito` provisional** hasta S7.

**Bugs reales encontrados por las pruebas y corregidos:** botones que se desactivan con el foco y lo pierden (paginación, carrusel, stepper de cantidad, flechas del visor de la galería, y la paginación del panel de S3) → `aria-disabled`; `twMerge` descartaba los tokens propios (`text-display-*`, `rounded-card`) → registrados; negrita falsa de fuentes con un solo peso → rango de pesos por cara; salto del pie al cargar pantallas diferidas → fallback con altura mínima; `TooltipProvider` en `App` arrastraba floating-ui a todas las páginas → solo donde se usa; migas del panel con `li` anidado.

**Revisión independiente** (agente sin contexto, solo lectura): 18 hallazgos, todos verificados y corregidos salvo los marcados en «Pendiente». Los más graves, que ni mis tests ni el E2E veían: **`container.screens` con `var()` generaba una media query inválida** (el contenedor medía 1920 px en pantallas grandes; ahora literal + test de configuración + E2E a 1920 px) · el enlace estirado de `ProductCard` era `inline` y el anillo de foco casi no se pintaba · la X de los cajones se iba con el scroll (ahora el cuerpo desplazable es propio y la X queda fuera) · el MegaMenu abierto con teclado se cerraba al rozar el ratón y soltaba el foco · en Safari/Firefox (macOS) el clic no enfoca el botón y el diálogo «devolvía» el foco a `<body>` · correos largos en el pie y nombres sin espacios en las migas desbordaban · el carrusel animaba con «reducir movimiento» (embla anima por JS) · mensajes de zod que no correspondían al error (`.int()`, `.positive()`, `.length()`, fechas) · `Supr` no podía borrar un dígito tras el espacio de la máscara de teléfono · `Button loading` y la paginación con `NaN`.

**Verificación (2026-10-30):**
- **Unitarias:** 1742 (S3: 1268) con lint `--max-warnings=0`, Prettier y `tsc` limpios. **E2E Chromium móvil + escritorio: 208** (S3: 122; 207 a la primera y el que falló —un selector ambiguo de S3— pasó tras acotarlo), con axe WCAG 2.1 A/AA sobre la guía y las pantallas existentes. **WebKit (Safari de escritorio + iPhone 14 emulado): 74** (humo + guía), comprobación puntual con una configuración temporal, hecha ANTES del rediseño de cabecera y pie y no repetida después; no está en el CI. Firefox no se probó (no instalado).
- **Mutación (bugs inyectados a propósito, todos detectados al final):** tokens 10/10, primitivas 21/21 (+3 supervivientes iniciales corregidos con mejores tests), `cn` y paginación 7/7, máscara de teléfono, zod y registro 10/10, arreglos de la revisión 14/14 en unitarias y 6/6 en E2E, componentes de producto 42 (agente) y layouts 24 (agente). Fallos de mis propios tests encontrados en el camino: un test que no discriminaba (diálogo no controlado), un `setValue` redundante, y varios selectores/transiciones del E2E.
- **Lighthouse** (Chrome headless sobre el build): accesibilidad **100** en `/_ui` (móvil y escritorio) y en la portada; buenas prácticas 100; rendimiento de la portada en móvil 93 (LCP 2,9 s con la red simulada lenta, CLS 0,041, TBT 110 ms). La guía en móvil sale con 71: es una página interna de 7 000 px.
- **CLS:** la portada 0,041 (el aviso del banner empuja la página ~36 px al llegar el dato; dentro del umbral «bueno» de 0,1). Las pantallas diferidas reservan `70vh` para que el pie no salte.
- **Peso:** entrada pública gzip ≈ **244 kB** (S3: 214) · CSS ≈ 9 kB gzip (S3: 5,3) · fuentes 57 kB. Subida esperable por Radix Dialog/Accordion en la cabecera; mejora posible no hecha: carga diferida de `MobileMenu` y `SearchSheet` (≈ −20 kB).
- `npm audit`: las mismas 18 vulnerabilidades que antes de S4 (herramientas de desarrollo: eslint, vite, vitest, esbuild y el aviso de `zod` ya conocido); ninguna viene de las dependencias nuevas (todas de Radix).

**Pendiente (no hecho):**
- **Diseño:** revisión pixel-fina con la diseñadora y firma del checklist de fidelidad (el criterio 1 del sprint); licencia web de Baskerville/Intelo; logo en SVG; decisión de modo oscuro.
- **Zonas seguras de iOS:** el código usa `env(safe-area-inset-*)` pero son inertes sin `viewport-fit=cover`; activarlo exige margen lateral y prueba en un iPhone real.
- **Revisión manual** con VoiceOver y con Safari/Chrome reales en dispositivo (solo hay emulación y WebKit de escritorio).
- **Botones «Subir/Bajar» de reordenar de S3** (categorías, colecciones, imágenes, relacionados) siguen usando `disabled` en los extremos y pierden el foco al llegar a ellos.
- **Búsqueda** sin ruta (campo desactivado) y **bolsa** a pantalla provisional hasta S7; `useCartCount` devuelve 0 hasta S7.
- Carga diferida de `MobileMenu`/`SearchSheet` (peso); `Tabs`/`Tooltip` apenas usados fuera de la guía.
- Los ajustes públicos del pie solo muestran lo que hay (hoy el dato de contacto del seed es de ejemplo).
