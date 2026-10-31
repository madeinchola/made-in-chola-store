# Sprint 3 — Admin: shell + CRUD de catálogo

**Release:** R1 · **Estimación:** 5 días · **Depende de:** S1 (guards admin), S2 (datos, storage, RPC)

## Objetivo
Un panel de administración **simple para usuarios de nivel técnico bajo** con CRUD completo de productos (el núcleo del MVP), categorías, colecciones, tipo de cambio, banner de noticias y alertas de stock en pantalla.

## Alcance
**Dentro:** layout admin, navegación, productos (crear/editar/archivar/restaurar), variantes y stock, precios por moneda, imágenes (subida, orden, asignación a color), categorías/colecciones, relacionados, tipo de cambio, ajustes, banner, semáforo de stock, auditoría visible.
**Fuera:** pedidos (S12), dashboard analítico (S14), importación masiva (S14), envío de correos de alerta (se encolan en `notification_outbox`; el envío real llega en S13).

> La UI definitiva viene de la diseñadora (S4). Aquí se usan componentes shadcn con estilos neutros; el reskin se hace en S4 sin reescribir lógica.

## Reglas de negocio cubiertas
BR-CAT-01..06, BR-INV-05, BR-PRC-02, BR-PRC-06, BR-ADM-03, BR-ADM-04, BR-DAT-01, S-01, S-03.

## Tareas

### Base de datos (migración de S3)
> Añadido en la revisión del 2026-10-29: S3 consume estas piezas y **ningún sprint anterior las creó**.
- [x] **`notification_outbox` mínima** (S13 la completa): `id`, `type`, `channel` (`email|whatsapp`), `recipient`, `payload jsonb`, `status` (`pending|sent|failed`), `attempts`, `next_retry_at`, **`dedupe_key` único**, `created_at`. Deny-by-default: solo el admin la lee; el navegador no inserta; se escribe con una función `SECURITY DEFINER` (con `search_path`) ejecutable solo por `service_role`/triggers. Entra en la lista blanca de `05_estructura_seguridad.test.sql`.
- [x] **Alerta de stock** (BR-INV-05): al cruzar el umbral (ok→bajo, bajo→agotado) se encola `stock_alert` con `dedupe_key` por variante+estado; no se repite cada minuto y se re-arma cuando el stock vuelve a subir de umbral.
- [x] **`product_slug_history`** (`product_id`, `slug`, `changed_at`, `changed_by`) + trigger en `products` al cambiar `slug`. Lectura pública solo por una vista (`public_product_slug_redirects`: slug antiguo → slug actual, solo productos visibles), igual que el resto de S2: `anon` sin privilegios sobre la tabla. Si un slug antiguo vuelve a ser vigente en otro producto, prevalece el vigente. S5 consume esto para sus redirecciones.
- [x] **Control optimista** (criterio 5): las tablas de catálogo ya tienen `updated_at` con trigger (S2). Guardar con `… where id = $1 and updated_at = $leído`; 0 filas = conflicto. **Ojo:** `timestamptz` guarda microsegundos y `Date` de JS solo milisegundos: el cliente debe devolver el `updated_at` como **texto tal cual lo recibió**, nunca pasarlo por `Date`, o todo guardado parecerá un conflicto.
- [x] Tests pgTAP de las tres piezas (RLS por rol, deduplicación, historial) y mutaciones sobre ellas.

### Shell admin
- [x] `AdminLayout` (sidebar colapsable, header con usuario, breadcrumbs), responsive para tablet.
- [x] Rutas: `/admin`, `/admin/productos`, `/admin/categorias`, `/admin/colecciones`, `/admin/ajustes`, `/admin/monedas`, `/admin/auditoria`.
- [x] Componentes comunes: tabla con búsqueda/filtros/orden/paginación servidor, confirmaciones, *empty states*, toasts, formulario con guardado y **aviso de cambios sin guardar**.

### Productos
- [x] Listado: foto, nombre, código, categorías, precio (moneda activa), stock total con **semáforo**, estado (activo/agotado/oculto/archivado); filtros (categoría, colección, stock, estado, archivados).
- [x] Formulario de producto con secciones: Datos (nombre, descripción, modelo, código, materiales, washcare), Precios por moneda/país, Colores y tallas (tallas opcional), **Variantes y stock** (matriz color×talla editable), Imágenes, Categorías/Colecciones (multi), Delivery (S-03), Relacionados, Costo, Comportamiento sin stock (`Agotado`/`Ocultar`).
- [x] Generación automática de variantes a partir de colores×tallas; añadir/quitar sin perder stock existente.
- [x] Subida de imágenes múltiple con progreso, reordenar (drag & drop con `@dnd-kit`), marcar principal, asociar a color, alt text; compresión/redimensión en cliente.
- [x] Slug autogenerado y editable con validación de unicidad en vivo; código único.
- [x] **Archivar/Restaurar** (nunca borrar), con confirmación explícita y explicación del efecto.
- [x] Ajuste de stock por variante con motivo (genera `stock_movements`); bloqueo por debajo de lo comprometido (ver S2).
- [x] Duplicar producto (clona estructura sin stock ni imágenes bloqueantes) — ahorra tiempo al admin.
- [x] Vista previa "cómo se verá en tienda".

### Categorías / colecciones / ajustes / monedas
- [x] CRUD con jerarquía (árbol arrastrable), archivar, vigencia opcional en colecciones.
- [x] Ajustes: umbrales de semáforo (global), TTL de reserva (solo lectura/avanzado), datos de contacto/WhatsApp, banner de noticias (texto, enlace, vigencia, activo).
- [x] **Monedas:** activar/desactivar, tipo de cambio fijo o variable, historial de cambios, vista previa de impacto en precios calculados.
- [x] Alerta visual de **stock bajo/crítico** en el panel (campana + tarjeta) y escritura en `notification_outbox` (tipo `stock_alert`) con deduplicación (no repetir cada minuto).
- [x] Pantalla de **auditoría** (filtro por entidad/usuario/fecha) en solo lectura.

## Notas heredadas de S0–S2 (verificadas el 2026-10-29)
- **S-03 / `product_delivery` NO existe** (S2 no lo implementó: supuesto sin confirmar con el dueño). El formulario **omite la sección "Delivery"** hasta que se confirme; no inventar la tabla.
- **El modelo tiene un precio por producto, no por variante:** el "DESDE $X" del diseño no aplica.
- **Escritura del admin = INSERT/UPDATE por columnas bajo RLS** (no hay RPC por tabla): toda columna nueva que el panel deba editar hay que añadirla a su `GRANT` por columna / `_apply_admin_rls`, o el panel recibirá 403. Asociaciones por RPC `admin_set_product_categories|collections|related`; quitar un precio, `admin_delete_product_price`.
- **Nada se borra, ni `service_role`:** se archiva. Archivar un color o talla archiva sus variantes; no se puede archivar la última variante de un producto publicado.
- **`exchange_rates` es inmutable:** un error de tipeo no se corrige, solo se supera con otra fila ⇒ confirmación ante un tipo de cambio muy distinto del anterior o con fecha lejana.
- El formulario usa el ajuste `default_out_of_stock_behavior` como valor por defecto. La vista previa del slug usa `slugify` (paridad exacta con SQL hasta U+017F).
- **Storage en local:** usar solo `npx supabase` / `npm run db:*` (ver README, «Una sola versión del CLI»); con un CLI mezclado toda subida de imagen da 500 `42P10`.

## Criterios de aceptación
1. Un admin crea un producto completo (3 colores × 4 tallas, 5 imágenes, 2 categorías, precio BOB) en < 5 minutos sin ayuda.
2. Archivar quita el producto de la tienda y se puede restaurar; nada se borra.
3. El semáforo cambia de color al cruzar umbrales y aparece la alerta.
4. Cambios de tipo de cambio se reflejan en precios calculados y quedan auditados.
5. Dos admins editando el mismo producto: el segundo guardado detecta el conflicto (no pisa en silencio).
6. Un `customer` no puede acceder a ninguna ruta ni endpoint admin.

## Testing
- **Unit/Componentes:** formulario de producto (validaciones zod: precios, slug, códigos, al menos 1 color, stock entero ≥ 0), generador de variantes, semáforo, reordenamiento de imágenes.
- **Integración:** CRUD contra Supabase local (crear, editar, archivar, restaurar), subida a Storage, auditoría generada.
- **E2E (Playwright):** flujo completo de alta de producto; archivar/restaurar; edición de stock y alerta; permisos (customer redirigido).
- **Concurrencia de edición:** dos sesiones guardando el mismo producto (control optimista con `updated_at`/versión).
- **Usabilidad:** prueba con el admin real (nivel técnico bajo) con guion de tareas; medir fricción y errores.
- **Regresión:** cada bug encontrado añade un test.

## Edge cases
- Eliminar un color/talla que tiene stock o reservas → exigir confirmación y reubicar/archivar variante, no perder historial.
- Cambiar nombre/slug de un producto ya indexado/compartido → mantener redirección (guardar slug anterior).
- Subir imagen enorme (20 MB), formato no soportado, nombre con caracteres raros, red intermitente a mitad de subida (reanudar/reintentar), duplicados.
- Pegar texto con formato/HTML malicioso en descripción → sanitizar (XSS).
- Producto sin imágenes o sin stock publicándose: validación y advertencia.
- Precio vacío en una moneda activa → bloquear publicación o calcular por tipo de cambio (según regla), avisar claramente.
- Cambio de tipo de cambio con precios calculados vigentes en carritos (efecto sobre S7: el carrito respeta su precio, S-04).
- Muchas variantes (p. ej. 12 colores × 10 tallas = 120): rendimiento de la matriz.
- Archivar un producto referenciado como relacionado de otro.
- Doble clic en "Guardar"; pérdida de conexión al guardar; pestaña cerrada con cambios sin guardar.
- Admin A archiva mientras Admin B edita.
- Caracteres especiales/emoji en nombres y búsqueda (acentos, ñ).
- Zonas horarias en vigencia de colecciones/banner.

## Revisión
- [x] Checklist universal.
- [x] Revisión de seguridad: ningún endpoint admin sin `is_admin()`; sanitización de entradas.
- [ ] Revisión UX con el admin: textos, orden de campos, mensajes de error en lenguaje simple.
- [x] Rendimiento del listado con 1 000 productos (paginación servidor, índices).
- [x] Accesibilidad del formulario (labels, foco, errores asociados).

## Riesgos
- Formulario de producto muy complejo → dividirlo en secciones guardables independientemente si hace falta.
- Subida de imágenes pesadas ralentiza el flujo → compresión en cliente y subida en paralelo con límites.

## Pendientes externos
Umbrales de semáforo; textos del banner; definición S-03; costos por producto para margen futuro.

## Entregables para sprints siguientes
Panel admin operativo, catálogo cargable con datos reales, `AdminLayout` y componentes de tabla/formulario reutilizables (S8, S9, S12, S14), outbox de alertas de stock.

---

## Estado real de entrega (2026-10-30)

**Entregado:** todo lo de la lista de tareas salvo lo marcado en "Desviaciones" y "Pendiente". Migración `20261029000100_s3_outbox_slugs_duplicar.sql` (outbox mínima, trigger de alerta de stock, historial de slugs con `was_public`, `admin_duplicate_product`, `admin_set_stock`, vistas `admin_product_list` y `public_product_slug_redirects`); panel `/admin` (resumen con alertas, productos, categorías, colecciones, monedas, ajustes con banner, auditoría); control de edición concurrente en toda actualización; textos en i18n por área; carga diferida de cada pantalla.

**Desviaciones respecto al plan (y por qué):**
- **Sección "Delivery" omitida:** `product_delivery` no existe (supuesto S-03 sin confirmar con el dueño).
- **Subida de imágenes sin barra de bytes:** `supabase-js` no expone el progreso; hay cola con estado por archivo (en cola / subiendo / subida / falló) y **reintento**, no reanudación a mitad de archivo.
- **Árbol de categorías:** se reordena entre hermanas (arrastre o botones); cambiar de padre se hace editando la categoría (evita ciclos por accidente).
- **Stock por delta → valor exacto con comprobación** (`admin_set_stock`): la revisión independiente mostró que enviar un delta calculado al abrir la pantalla daba un resultado distinto de lo escrito si el stock cambiaba entre tanto.
- **Umbrales de stock por variante:** existen en la base pero el panel solo edita los globales (Ajustes).
- Las **vistas previas** muestran el producto GUARDADO y son aproximadas (el diseño final llega con S4/S5).

**Verificación (todo ejecutado, no solo leído):** 1268 unitarias/componentes (eran 410) · 864 asserts pgTAP (140 nuevos; en BD sembrada y en BD vacía) · 234 de integración contra la base real (115 nuevos: edición concurrente real, 20 guardados simultáneos → 1 ganador, RLS por rol, Storage, alertas, auditoría, tasas) · 122 E2E en móvil y escritorio (2 se omiten a propósito: aplican a un solo viewport) con axe WCAG A/AA en cada pantalla. `tsc`, ESLint (0 avisos) y Prettier limpios.
- **Pruebas de mutación:** SQL de S3, 29 mutaciones (20 + 6 de `admin_set_stock` + 3 de `was_public`) con 27 detectadas; las 2 que sobrevivieron son equivalentes (`anon` nunca tuvo privilegio por defecto; el filtro `is_admin()` externo de `admin_product_list` es defensa en profundidad porque la vista de stock ya filtra). Categorías/colecciones: 10/10; ajustes/monedas/auditoría: 21 con 2 huecos cerrados.
- **Revisión independiente** (agente sin conocer mis conclusiones): 14 hallazgos reales (0 críticos, 0 altos, 6 medios, 8 bajos). Todos corregidos con test, salvo que el reordenamiento (imágenes, categorías, colecciones) sigue siendo una escritura por fila (sin RPC atómica): si una falla, la pantalla recarga y muestra el orden real.
- **Bugs que encontraron las propias pruebas:** página fuera de rango daba error 416 (productos y auditoría) · el diálogo no devolvía el foco · el cajón móvil cerrado seguía accesible con teclado · imagen sin texto alternativo quedaba decorativa en el editor · `Number("1e3")` pasaba por página válida · el título original no se restauraba al salir del panel · cobertura insuficiente del recorte del umbral crítico, del nivel repetido y del slug de un producto archivado.

**Bundle:** entrada pública ≈ 214 kB gzip (S1: 202) + CSS 5,3 kB; el panel son ~38 chunks de carga diferida (≈ 100 kB gzip en total) que solo descarga un admin.

**Rendimiento (1030 productos, con estadísticas al día):** primera página del listado 38 ms; filtro de alertas 14 ms. **Riesgo para S16:** el join con `admin_product_stock` es un bucle anidado casi cuadrático (516 000 filas descartadas a 1000 productos); revisar con EXPLAIN si el catálogo supera ~5 000.

**Pendiente (no hecho):** prueba de usabilidad con la administradora real (guion de tareas) · revisión de `vercel.json` por segunda persona · subir la migración a Supabase en la nube (`db push`, necesita confirmación) · decidir antes de S7 qué hacer con el aviso alto de `zod` (hoy no hay colecciones validadas) · `product_delivery` cuando se confirme S-03.

**Limitaciones conocidas:** "tipo de cambio vigente" usa el reloj del navegador (la base usa el suyo) · un slug público solo redirige si se renombró mientras el producto estaba publicado (si se pasa a borrador, se renombra y se republica, el anterior no redirige) · el aviso de cambios sin guardar usa el aviso del navegador al cerrar la pestaña (no se puede personalizar).
