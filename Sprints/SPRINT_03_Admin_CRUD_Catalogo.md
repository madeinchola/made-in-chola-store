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
- [ ] **`notification_outbox` mínima** (S13 la completa): `id`, `type`, `channel` (`email|whatsapp`), `recipient`, `payload jsonb`, `status` (`pending|sent|failed`), `attempts`, `next_retry_at`, **`dedupe_key` único**, `created_at`. Deny-by-default: solo el admin la lee; el navegador no inserta; se escribe con una función `SECURITY DEFINER` (con `search_path`) ejecutable solo por `service_role`/triggers. Entra en la lista blanca de `05_estructura_seguridad.test.sql`.
- [ ] **Alerta de stock** (BR-INV-05): al cruzar el umbral (ok→bajo, bajo→agotado) se encola `stock_alert` con `dedupe_key` por variante+estado; no se repite cada minuto y se re-arma cuando el stock vuelve a subir de umbral.
- [ ] **`product_slug_history`** (`product_id`, `slug`, `changed_at`, `changed_by`) + trigger en `products` al cambiar `slug`. Lectura pública solo por una vista (`public_product_slug_redirects`: slug antiguo → slug actual, solo productos visibles), igual que el resto de S2: `anon` sin privilegios sobre la tabla. Si un slug antiguo vuelve a ser vigente en otro producto, prevalece el vigente. S5 consume esto para sus redirecciones.
- [ ] **Control optimista** (criterio 5): las tablas de catálogo ya tienen `updated_at` con trigger (S2). Guardar con `… where id = $1 and updated_at = $leído`; 0 filas = conflicto. **Ojo:** `timestamptz` guarda microsegundos y `Date` de JS solo milisegundos: el cliente debe devolver el `updated_at` como **texto tal cual lo recibió**, nunca pasarlo por `Date`, o todo guardado parecerá un conflicto.
- [ ] Tests pgTAP de las tres piezas (RLS por rol, deduplicación, historial) y mutaciones sobre ellas.

### Shell admin
- [ ] `AdminLayout` (sidebar colapsable, header con usuario, breadcrumbs), responsive para tablet.
- [ ] Rutas: `/admin`, `/admin/productos`, `/admin/categorias`, `/admin/colecciones`, `/admin/ajustes`, `/admin/monedas`, `/admin/auditoria`.
- [ ] Componentes comunes: tabla con búsqueda/filtros/orden/paginación servidor, confirmaciones, *empty states*, toasts, formulario con guardado y **aviso de cambios sin guardar**.

### Productos
- [ ] Listado: foto, nombre, código, categorías, precio (moneda activa), stock total con **semáforo**, estado (activo/agotado/oculto/archivado); filtros (categoría, colección, stock, estado, archivados).
- [ ] Formulario de producto con secciones: Datos (nombre, descripción, modelo, código, materiales, washcare), Precios por moneda/país, Colores y tallas (tallas opcional), **Variantes y stock** (matriz color×talla editable), Imágenes, Categorías/Colecciones (multi), Delivery (S-03), Relacionados, Costo, Comportamiento sin stock (`Agotado`/`Ocultar`).
- [ ] Generación automática de variantes a partir de colores×tallas; añadir/quitar sin perder stock existente.
- [ ] Subida de imágenes múltiple con progreso, reordenar (drag & drop con `@dnd-kit`), marcar principal, asociar a color, alt text; compresión/redimensión en cliente.
- [ ] Slug autogenerado y editable con validación de unicidad en vivo; código único.
- [ ] **Archivar/Restaurar** (nunca borrar), con confirmación explícita y explicación del efecto.
- [ ] Ajuste de stock por variante con motivo (genera `stock_movements`); bloqueo por debajo de lo comprometido (ver S2).
- [ ] Duplicar producto (clona estructura sin stock ni imágenes bloqueantes) — ahorra tiempo al admin.
- [ ] Vista previa "cómo se verá en tienda".

### Categorías / colecciones / ajustes / monedas
- [ ] CRUD con jerarquía (árbol arrastrable), archivar, vigencia opcional en colecciones.
- [ ] Ajustes: umbrales de semáforo (global), TTL de reserva (solo lectura/avanzado), datos de contacto/WhatsApp, banner de noticias (texto, enlace, vigencia, activo).
- [ ] **Monedas:** activar/desactivar, tipo de cambio fijo o variable, historial de cambios, vista previa de impacto en precios calculados.
- [ ] Alerta visual de **stock bajo/crítico** en el panel (campana + tarjeta) y escritura en `notification_outbox` (tipo `stock_alert`) con deduplicación (no repetir cada minuto).
- [ ] Pantalla de **auditoría** (filtro por entidad/usuario/fecha) en solo lectura.

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
- [ ] Checklist universal.
- [ ] Revisión de seguridad: ningún endpoint admin sin `is_admin()`; sanitización de entradas.
- [ ] Revisión UX con el admin: textos, orden de campos, mensajes de error en lenguaje simple.
- [ ] Rendimiento del listado con 1 000 productos (paginación servidor, índices).
- [ ] Accesibilidad del formulario (labels, foco, errores asociados).

## Riesgos
- Formulario de producto muy complejo → dividirlo en secciones guardables independientemente si hace falta.
- Subida de imágenes pesadas ralentiza el flujo → compresión en cliente y subida en paralelo con límites.

## Pendientes externos
Umbrales de semáforo; textos del banner; definición S-03; costos por producto para margen futuro.

## Entregables para sprints siguientes
Panel admin operativo, catálogo cargable con datos reales, `AdminLayout` y componentes de tabla/formulario reutilizables (S8, S9, S12, S14), outbox de alertas de stock.
