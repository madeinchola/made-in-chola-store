# Sistema de UI (Sprint 4)

Guía de uso del sistema de diseño. Para verlo funcionando: `npm run dev:web` y abrir **`/_ui`** (la guía de componentes; solo existe en desarrollo y en el build del E2E, nunca en producción).

## Principios

- **Todo el aspecto sale de tokens.** `src/styles/tokens.css` define color, tipografía, radios, sombras, movimiento y medidas; `tailwind.config.ts` solo les da nombre. Cambiar un valor ahí cambia toda la interfaz (tienda **y** panel de administración). Un E2E lo comprueba cambiando `--primary` en vivo.
- **Sin estilos "mágicos".** Prohibido usar colores crudos de Tailwind (`amber-300`, `red-50`…) o hex en componentes: se usan los nombres semánticos (`bg-warning-soft`, `text-muted-foreground`, `border-input`…). Los estados tienen su propio token: `success`, `warning`, `destructive`, `info` (cada uno con su fondo `-soft`).
- **El significado nunca va solo en el color.** Un `Badge` siempre lleva texto; los iconos decorativos van con `aria-hidden`.
- **Accesibilidad como requisito:** foco visible global, teclado en todos los componentes interactivos, `prefers-reduced-motion` desactiva animaciones y transiciones (las de CSS por una regla global; el deslizamiento del carrusel/galería, que anima JavaScript, salta sin animar vía `lib/motion.ts`).

## Tokens

| Familia | Tokens | Notas |
| --- | --- | --- |
| Color base | `background` `foreground` `card` `popover` `primary` `secondary` `muted` `accent` | muestreados de los PDF: fondo `#F5F4F4`, marrón `#382F21`, baldosa `#E2DEDE` |
| Bordes y foco | `border` (decorativo) · `input` (delimita controles) · `ring` | `input` es más oscuro que `border` a propósito (≥ 3:1, WCAG 1.4.11) |
| Estados | `success` `warning` `destructive` `info` + `-soft` | texto y fondo suave son AA entre sí |
| Tipografía | `--font-display` · `--font-sans` · `--text-display-{xl,lg,md,sm}` · `--tracking-eyebrow` | clases `text-display-*`, `font-display`, `.eyebrow` |
| Radios | `rounded-sm/md/lg` (2/4/6 px) · `rounded-card` (14 px) · `rounded-pill` | controles casi rectos como en el diseño |
| Sombras | `shadow-sm/md/lg` | sutiles: el diseño es plano |
| Movimiento | `duration-fast/base/slow` · `ease-standard` | 120 / 200 / 360 ms |
| Maquetación | `--gutter` · `py-section` · `h-header` | fluidos con `clamp()`. El ancho máximo del contenedor (1400 px) es un literal en `tailwind.config.ts`: `var()` no vale en media queries |
| Superficie invertida | clase `.theme-inverse` | redefine las variables semánticas: pie de página y barra de anuncios se adaptan solos (texto, borde y anillo de foco) |

**Desviaciones deliberadas respecto al PDF** (para cumplir WCAG AA 2.1; las cubre `src/styles/tokens.test.ts`, que recalcula los contrastes leyendo el CSS real):

1. El texto atenuado es más oscuro que el gris claro del diseño (≥ 4.5:1 sobre fondo, baldosa y atenuado).
2. El borde de los campos de formulario es más oscuro que un borde decorativo (≥ 3:1).

**Modo oscuro: no incluido.** Era opcional en el sprint y el diseño solo existe en claro. Para añadirlo bastaría redefinir las variables bajo `.dark` (Tailwind ya está en `darkMode: class`) y extender el test de contraste. Decisión pendiente con la diseñadora.

## Zonas seguras (notch / barra de inicio de iOS) — pendiente de verificar en dispositivo

Los cajones, el pie y los menús ya usan `env(safe-area-inset-*)`, pero **hoy valen 0**: sin `viewport-fit=cover` en la etiqueta `viewport` de `index.html`, Safari ya recorta el contenido a la zona segura. Activar `viewport-fit=cover` obliga además a dar margen lateral al contenedor (`env(safe-area-inset-left/right)`) y debe probarse en un iPhone real; por eso no se activó. Hasta entonces el código es inerte y correcto, no una garantía probada.

## Fuentes

**Provisionales y autoalojadas** (`public/fonts/`, la CSP ya permite `font-src 'self'`): **Baskervville** (sustituye a Baskerville, títulos) y **Jost** (sustituye a Intelo, texto), ambas con licencia OFL (copias en `public/fonts/LICENSE-*.txt`). Las originales no se usan hasta confirmar su licencia web (ver *Pendientes externos*).

- Solo subconjunto latino (cubre `á é í ó ú ñ ü ¿ ¡` y comillas): ≈ 57 kB entre las cuatro caras.
- `font-display: swap` + **cara de respaldo con métricas ajustadas** (`size-adjust`, `ascent/descent-override`, calculadas con fontTools sobre las fuentes reales y un texto en español) para que el cambio de fuente no mueva la página. El E2E mide el CLS de la portada.
- Se precargan las dos críticas (`<link rel="preload">` en `index.html`); caché inmutable de un año en `/fonts/*` (`vercel.json`).
- Cada cara declara el **rango** de pesos que cubre (`400 700`) para que el navegador no fabrique una negrita falsa con `font-semibold`.
- **Cómo cambiarlas** cuando llegue la licencia: (1) copiar los `.woff2` a `public/fonts/` con **nombre nuevo** (el caché es inmutable); (2) actualizar rutas en `src/styles/fonts.css` y los `preload` de `index.html`; (3) recalcular las caras "Fallback" (el script está descrito en el sprint: media de avance de un texto de muestra, fuente nueva / Arial o Times New Roman); (4) ajustar `--font-sans`/`--font-display` si cambia el nombre.

## Componentes

Todo en `src/components`. Los textos viven en `src/i18n/{ui,store,layout}.ts`.

### Primitivas (`components/ui`)

`Button` (variantes `default` `secondary` `outline` `ghost` `destructive` `link`; tamaños `sm` `default` `lg` `icon`; `caps` = estilo de la tienda; `loading`; `asChild`; `buttonVariants()` para enlaces con aspecto de botón) · `Badge` (tonos `neutral` `success` `warning` `danger` `info` `solid` `outline`) · `Input` · `Textarea` · `Select` (nativo) · `Field` (etiqueta + ayuda + error enlazados) · `PasswordInput` · `Checkbox` · `RadioGroup` · `Switch` · `Dialog` · `Sheet` (cajón en 4 lados, sobre `Dialog`) · `Tabs` · `Accordion` · `Tooltip` · `Toaster` (sonner con tokens) · `Skeleton` · `Breadcrumb` · `Pagination` (numerada, con enlaces reales opcionales) · `Carousel` (embla; sin reproducción automática, flechas del teclado).

Reglas útiles:

- `cn()` (`lib/utils.ts`) conoce los tokens propios; si añades un token de tamaño, radio, espaciado o tracking, regístralo ahí (hay test).
- Los diálogos y cajones devuelven el foco a quien los abrió (Radix solo lo hace con `DialogTrigger`; ver `dialog.tsx`).
- Los estilos de `Button` están en `button-variants.ts` (si se exportaran desde el `.tsx` la regla `react-refresh` avisaría y `lint-staged` no admite avisos).
- `Tooltip` no aparece al tocar: nunca pongas ahí información imprescindible.

### Componentes de producto (`components/store`)

Presentacionales: reciben datos por props (tipos de `features/catalog/types`), no consultan la base.

| Componente | Props principales | Notas |
| --- | --- | --- |
| `ProductCard` | `product`, `to?`, `priority?`, `headingAs?` | un solo enlace por tarjeta (enlace estirado sobre el nombre); chip «Nuevo»/«Agotado»; «5 colores» (singular «1 color», oculto si 0); nombre máx. 2 líneas con `title`; imagen con `width/height` (sin CLS) y marcador provisional si falta o falla |
| `PriceTag` | `price`, `compareAt?`, `size?` | `formatMoney` (BOB); el precio anterior solo se tacha si es mayor y de la misma moneda; `tabular-nums`, no desborda con montos grandes |
| `StockBadge` | `status` | Disponible / Pocas unidades / Agotado, siempre con texto |
| `ColorSwatch` / `ColorSwatchGroup` | `options`, `value`, `onValueChange` | borde SIEMPRE (blanco/crema se distinguen del fondo); hex nulo o inválido → patrón rayado; flechas del teclado (RadioGroup) |
| `SizeSelector` | `options`, `value`, `onValueChange` | tallas agotadas deshabilitadas, tachadas y con «(agotada)» para lectores; ≥ 44 px; sin tallas → no renderiza |
| `QuantityStepper` | `value`, `onChange`, `min?`, `max?`, `disabled?` | nunca emite NaN, 0 ni fuera de rango (ni con `1e3`, `-5`, pegado de texto); `aria-live`; **los límites usan `aria-disabled`, no `disabled`** |
| `Gallery` | `images`, `productName` | swipe (embla) + miniaturas + ampliar en diálogo con ←/→; una imagen → sin miniaturas; imagen rota → marcador. Para volver a la primera al cambiar de color, `key={colorId}` |
| `EmptyState` / `ErrorState` | `icon?`, `title?`, `description?`, `action?`, `onRetry?` | `role="status"` / `role="alert"`; textos por defecto en `ui.state.*` |

Las imágenes de los PDF **no** se usan: el marcador provisional (icono `Shirt` + texto para lectores) está marcado como tal en el código.

> **Lección que se repite:** un botón que se desactiva (`disabled`) mientras tiene el foco lo pierde (cae al `<body>`) y el teclado deja de funcionar. En «Siguiente» de la paginación (tienda y panel), flechas del carrusel, «+»/«−» del stepper, flechas del visor de la galería y `Button loading` se usa `aria-disabled` (con estilo y sin efecto; `loading` además frena el envío del formulario). Hay tests y E2E que lo vigilan. **Pendiente de S3:** los botones «Subir/Bajar» de reordenar (categorías, colecciones, imágenes y relacionados) siguen usando `disabled` en los extremos.

### Layouts (`components/layout`) — fieles al PDF de Inicio

Cabecera y pie reconstruidos midiendo el PDF a 1366 px (el ancho del diseño); un E2E (`e2e/layout.spec.ts`) comprueba las posiciones.

| Pieza | Diseño | Notas / desviaciones |
| --- | --- | --- |
| `Header` | 130 px de alto; izquierda «SHOP ⌄ · ABOUT» (aquí «TIENDA ⌄ · NOSOTROS»); centro el logotipo; derecha «BOLIVIA ⌄ · bolsa (0) · usuario · lupa» | **Portada**: transparente y blanca SOBRE el hero (`absolute`, sin borde). **Páginas interiores**: barra sólida con línea inferior, como Check Out. Un degradado oscuro tenue detrás de la cabecera de portada para que se lea sobre cualquier foto (el PDF no lo lleva: desviación por contraste). Estática en escritorio y pegajosa en móvil. Móvil (sin diseño, provisional): menú · logotipo reducido · bolsa, cuenta, búsqueda |
| `Wordmark` | «MADE IN CHOLA» en serif repartido en 3 filas que bajan en diagonal | letras posicionadas en `em` medidas del PDF; **provisional** hasta recibir el SVG del logotipo |
| `AccountMenu` | un solo icono de usuario | sin sesión: enlace «Ingresar»; con sesión: botón con el nombre que despliega «Mi cuenta», «Panel» (solo admin) y «Cerrar sesión» |
| `CartLink` | icono de bolsa y «(0)» | «(99+)» desde 100; el número exacto va en el nombre accesible |
| `CountrySelect` | «BOLIVIA ⌄» | `<select>` nativo con un único país hasta S18 |
| `MegaMenu` / `MobileMenu` / `SearchSheet` | «SHOP ⌄» despliega las categorías | buscador sin ruta todavía (campo desactivado, «próximamente») |
| `Footer` | fondo `#382F21`; símbolo arriba a la izquierda; 4 columnas con título serif subrayado (Índice del sitio · Síguenos · Contáctanos · Legal); línea y fila con Copyright · Políticas de Privacidad · Términos y Condiciones | textos en español; contacto y redes de los ajustes públicos (sin datos, la columna no se pinta vacía); **sin** el boletín «10 % OFF en tu primera compra» (decisión del dueño) y **sin** «Developed by VNS» (es de la agencia del diseño); el texto atenuado de la fila inferior es más claro que en el PDF (contraste AA); el símbolo es una aproximación **provisional** |
| `AnnouncementBar` | (no está en el PDF) | encima de la cabecera; no tapa la cabecera superpuesta |
| `PublicLayout` | | «Saltar al contenido» · barra de anuncios · cabecera + `main` · pie |
| `storeRoutes` | | única fuente de rutas; `PENDING_ROUTES` vigila las que aún no existen |

Pantallas provisionales (`PlaceholderPage`) para que el pie y la cabecera no den 404: `/nosotros`, `/contacto`, `/carrito`, `/legal/privacidad`, `/legal/reembolsos`, `/legal/envios`, `/legal/terminos`. Sus contenidos llegan con la diseñadora (nosotros, contacto) y en S15 (legales).

## Peso (auditoría de dependencias de UI)

Medido con `vite build` (gzip): la entrada pública pasó de ≈ 214 kB (S3) a **≈ 244 kB** (`index` 73 + `App` 171) por Radix Dialog + Accordion (cabecera y menú móvil), lucide y los componentes de layout. El CSS pasó de 5,3 a ≈ 9 kB. La guía `/_ui` NO entra en el build de producción. `TooltipProvider` no está en `App` (arrastraría floating-ui, ≈ 13 kB gzip): se envuelve donde se usa. **Mejora posible (no hecha):** cargar bajo demanda el contenido de `MobileMenu` y `SearchSheet` (solo el botón disparador en el chunk principal) ahorraría ≈ 20–25 kB gzip de la entrada; se hará junto con la partición por rutas de S5. Medido en el cierre: CSS ≈ 9 kB gzip (S3: 5,3) y fuentes 57 kB en 4 archivos `.woff2` latinos.

## Guía `/_ui` y pruebas

- **Guía:** `npm run dev:web` → `/_ui`. Muestra tokens (con el contraste calculado en vivo), tipografía, y cada componente en sus estados.
- **Build con la guía** (lo usa el E2E): `VITE_UI_GUIDE=true npm run build`. El build normal no la incluye (ni su código).
- **Unitarias:** `npx vitest run src/components src/styles src/lib/utils.test.ts`.
- **E2E (`e2e/ui-guide.spec.ts`):** axe WCAG 2.1 A/AA, sin scroll horizontal a 360/768/1280 px y a 640/320 px (equivalen al 200 % y 400 % de zoom), fuentes servidas desde el propio origen, fallo de carga de fuentes, cambio de token en vivo, `prefers-reduced-motion`, teclado en diálogo/cajón/acordeón/pestañas/carrusel y CLS de la portada. Guarda capturas por breakpoint en `test-results/` (no se versionan).
