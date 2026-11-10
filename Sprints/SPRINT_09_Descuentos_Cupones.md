# Sprint 9 — Descuentos y cupones

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S3 (panel), S7 (carrito y puntos de extensión de totales); coordina con S8 (orden de cálculo)

## Objetivo
Motor de descuentos configurable desde el panel que soporte todos los tipos pedidos, con **un solo cupón por pedido**, cálculo siempre en servidor y trazabilidad total.

## Alcance
**Dentro:** modelo de descuentos y cupones, motor de evaluación/aplicación, UI admin, UI cliente (ingresar cupón, ver descuentos), redenciones y límites de uso, integración con carrito.
**Fuera:** reembolso prorrateado (S12), referidos/afiliados (descartado), puntos/gift cards (descartado).

## Reglas de negocio cubiertas
BR-PRC-03, BR-PRC-04 (base para S12), BR-PRC-07.

## Tipos soportados (configurables desde el panel)
1. Cupón **porcentaje**.
2. Cupón **monto fijo**.
3. **Envío gratis** sobre un monto.
4. **2x1** (o N×M configurable) por producto/categoría/colección.
5. **Descuento por volumen** (tramos por cantidad).
6. **Precio por tipo de cliente** (grupos de clientes).
7. **Oferta flash** con fecha/hora de inicio y fin.
8. **Primera compra.**

## Tareas

### BD
- [ ] `discounts` (nombre, tipo, valor, `rules jsonb`, alcance `order|product|category|collection`, vigencia con zona horaria, `usage_limit_total`, `usage_limit_per_customer`, prioridad, `stackable_with_automatic bool`, moneda, activo, `archived_at`).
- [ ] `coupons` (código único normalizado, `discount_id`, activo, vigencia propia opcional).
- [ ] `customer_groups` + `customer_group_members` (para precio por tipo de cliente).
- [ ] `discount_redemptions` (discount_id, coupon_id, profile_id, order_id, monto aplicado, estado `reserved|applied|reverted`) — única por `(order_id)` para cupón.
- [ ] RPC `apply_discounts(cart_id, coupon_code?)` → `{lines[], applied[], rejected[{code,reason}], totals}`: **determinista**, define **orden de aplicación** (ofertas automáticas → cupón único → envío gratis) y reglas de combinación (un cupón por pedido, descuentos automáticos según flag).
- [ ] Control de usos **atómico** (evita pasarse del límite bajo concurrencia); reserva de uso al crear pedido, reversión si se cancela (S12).
- [ ] Nunca devuelve total negativo; el descuento no excede el subtotal elegible.
- [ ] Productos ya rebajados: política explícita (excluir por flag `exclude_sale_items`).

### Admin
- [ ] Listado con estado (activo/programado/vencido/agotado) y uso.
- [ ] Asistente de creación por tipo con vista previa en lenguaje claro ("10% en la colección Verano, máx. 100 usos").
- [ ] Generar códigos (manual/aleatorio/lote), activar/desactivar, archivar.
- [ ] Reporte de redenciones (quién, cuándo, cuánto) y exportación CSV.
- [ ] Auditoría de cambios.

### Cliente
- [ ] Campo de cupón en carrito/checkout; mensajes específicos de rechazo (vencido, límite alcanzado, no aplica a tus productos, ya usaste uno, mínimo no alcanzado).
- [ ] Desglose: precio original, descuento, precio final por línea y total.
- [ ] Banners de ofertas flash con cuenta regresiva (si el diseño lo incluye).

## Criterios de aceptación
1. El admin crea cada uno de los 8 tipos sin código ni ayuda.
2. Solo se acepta **un cupón por pedido**; los demás se rechazan con mensaje claro.
3. Los límites de uso total/por cliente se respetan bajo concurrencia.
4. El servidor recalcula y manda; el cliente nunca puede alterar el descuento.
5. Totales nunca negativos y siempre a 2 decimales; coinciden entre carrito y pedido.

## Testing
- **Unit (matriz de reglas):** cada tipo con casos válidos/borde (porcentaje 0/100/>100, monto > subtotal, 2x1 con cantidad impar, tramos de volumen en límites, primera compra con/sin historial, oferta flash a 1 segundo del inicio/fin).
- **Propiedad:** para cualquier combinación, `0 ≤ total ≤ subtotal+envío` y orden de aplicación estable.
- **SQL/RLS:** el cliente no lee la tabla de cupones (no se puede listar códigos); solo valida un código por RPC; admin CRUD.
- **Concurrencia:** 50 intentos simultáneos sobre un cupón con 1 uso restante; mismo cliente usando el cupón desde dos dispositivos.
- **Integración:** envío gratis + cupón (orden), 2x1 con productos rebajados, cupón con vigencia por zona horaria.
- **E2E:** aplicar/quitar/cambiar cupón; rechazo por vencido; oferta automática visible; cupón agotado.
- **Seguridad:** fuerza bruta de códigos → rate limit y respuesta uniforme; manipulación de la petición.

## Edge cases
- Cupón en mayúsculas/minúsculas/espacios; caracteres confusos (0/O).
- Cupón vence mientras el cliente completa el checkout → revalidar al crear pedido con mensaje claro.
- Cupón aplicado y luego el carrito baja del mínimo (se quita con aviso).
- Producto con precio por moneda distinta y descuento monto fijo (¿en qué moneda?): el monto fijo se define por moneda.
- Descuento sobre productos específicos que el cliente quita del carrito.
- Redondeo acumulado en descuentos por línea vs. por total (definir y probar: se redondea por línea, suma exacta).
- 2x1 con variantes distintas (mismo producto, distintos colores) y con precios distintos (se regala el más barato).
- Dos ofertas automáticas aplicables a la misma línea → prioridad/mejor oferta, sin doble descuento.
- Primera compra: cliente con pedido cancelado previo (¿cuenta como compra?). Decisión: solo cuentan pedidos no cancelados.
- Precio por tipo de cliente cuando el cliente cambia de grupo en pleno carrito.
- Cupón de un solo uso por cliente y el cliente cancela el pedido → devolver el uso (S12).
- Cupón y envío gratis sobre monto: el umbral se evalúa **antes o después** del descuento (documentar; propuesta: después).
- Zona horaria de vigencia (`America/La_Paz`) y horario de verano de otros países futuros.
- Oferta flash que se agota por stock antes de su fin.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión matemática del motor por segunda persona (ejemplos resueltos a mano).
- [ ] Revisión de abuso (enumeración de cupones, reutilización por cuentas múltiples).
- [ ] Revisión UX: textos de rechazo comprensibles.
- [ ] Alineación del orden de cálculo con S8 y S10 documentada en el maestro.

## Riesgos
- Complejidad combinatoria de reglas → limitar combinaciones permitidas y cubrir con tests de propiedad.
- Cuentas múltiples para reutilizar "primera compra" → criterio por teléfono/dirección (reforzar en S12/lista negra).

## Pendientes externos
Cupones/promociones de lanzamiento; política de combinación con productos rebajados (PENDIENTES_ADMIN §F).

## Entregables para sprints siguientes
`apply_discounts` estable, redenciones atómicas, admin de descuentos, desglose de líneas para S10 (snapshots) y S12 (reembolso prorrateado).

---

## Decisiones del admin que afectan a este sprint (2026-10-28)
Fuente: `docs/admin/Cuestionario_Admin_RESPONDIDO.pdf` y [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md). El dueño **aún no definió los cupones y ofertas de lanzamiento** (§F): lo que hay en la nube son valores de **ejemplo**. Un solo cupón por pedido (BR-PRC-03).

---

## Estado real de entrega (2026-11-09)

**Entregado:** motor de descuentos **determinista** en SQL (`_discount_evaluate`: no escribe nada; orden ofertas automáticas → un solo cupón → envío gratis; importes enteros en la unidad menor de la moneda, redondeo por línea con suma exacta, monto fijo por mayor resto) con los **8 tipos** (porcentaje con tope, monto fijo, envío gratis, «llévate N, paga M», volumen por tramos, precio por grupo de clientas, oferta flash y primera compra); `apply_discounts(cart_id, cupón, envío, ahora)` para el checkout; 6 tablas (`discounts` con `params jsonb` validado por un `CHECK`, `discount_targets`, `coupons`, `customer_groups`, `customer_group_members`, `discount_redemptions`) y la vista `discount_usage`; códigos **normalizados** (mayúsculas, sin espacios/guiones, O→0, I→1, L→1) con una **respuesta uniforme** para códigos que no existen, apagados, archivados o futuros (`invalid_code`); **usos atómicos** (`discount_reserve` / `discount_commit` / `discount_release`, candado de fila, todo o nada, idempotente); generación de códigos al azar en el servidor; el cupón vive en `carts.coupon_code` (se reevalúa en cada lectura y pasa de invitada a cuenta al fusionar); la Edge Function `cart` con las acciones `set_coupon` / `remove_coupon` y **tope de intentos** (12 por persona y 60 por red cada 10 minutos); **panel `/admin/descuentos`** (Descuentos con asistente de dos pasos y vista previa en lenguaje claro, Códigos —a mano, al azar, CSV—, Redenciones con CSV, Grupos de clientes); en la bolsa, **campo de cupón**, descuento por línea y en el resumen, y el estimador de envío con envío gratis. Detalle en `docs/descuentos.md`. **Los valores cargados son de ejemplo** (`EJEMPLO10`, `EJEMPLO20`, `BIENVENIDA10`, marcados «(ejemplo)»).

**Cómo se hizo:** base de datos, motor, pruebas SQL, capa de datos, contrato SQL↔TS, almacén del carrito y el campo de cupón por mí; las pantallas del panel por tres subagentes (cortados por el límite de 5 h de la cuenta, error 429: se retomaron **de uno en uno**, lo hecho quedó en disco); una **revisión independiente** (agente sin contexto, solo lectura; 10 hallazgos); mutaciones en SQL y en la interfaz. Todo se probó **contra la nube** (sin base local ni Docker).

**Desviaciones respecto al plan (y por qué):**
- **`params jsonb` en vez de `rules jsonb`**, con un `CHECK` por tipo (`_discount_params_valid`), y los objetivos de alcance en una tabla aparte (`discount_targets`: producto, categoría o colección; un archivado no cuenta).
- **Un descuento vale para UNA moneda** (hoy solo BOB).
- **`discount_redemptions` es única por `(owner_type, owner_id)` y no por `order_id`**: todavía no hay pedidos; el dueño de la reserva es el carrito o, en S10, el pedido.
- **`apply_discounts` recibe también el envío y un «ahora» inyectable** (para probar vigencias con un reloj fijo) y devuelve `{lines, applied, rejected, coupon, free_shipping, totals}`.
- **Cupón que no se acumula con las ofertas = la MEJOR de las dos opciones para el pedido entero** (gana el cupón solo si baja más; en empate gana la oferta y el cupón no gasta su uso). Con «no aplicar a productos ya rebajados» el cupón y las ofertas tocan líneas distintas y **conviven**. Decisión mía, pendiente de confirmar con el dueño (SPRINT_19 §N).
- **«Primera compra» por cuenta**; `_customer_order_count` vale 0 hasta que S10 la redefina.
- **Un código que existe se delata con un motivo específico** (vencido, agotado, mínimo no alcanzado…): es lo que pide el sprint («mensajes específicos»); se mitiga con el tope de intentos. Lo que **no** se filtra es la existencia: inexistente, apagado, archivado y futuro dan la misma respuesta.
- **Banner de oferta flash con cuenta regresiva: no se hizo** (los diseños no lo incluyen).
- **El pago no existe todavía**: el desglose llega hasta el total de la bolsa; «coincide con el pedido» es de S10.

**Bugs reales encontrados por las pruebas y corregidos:**
- *`record "c" is not assigned yet`* con envío gratis automático y sin cupón (PL/pgSQL no deja leer campos de un registro sin asignar): `c` se inicializa con una consulta vacía.
- *El código del rechazo delataba la existencia por la capitalización* (devolvía el código guardado en vez de lo escrito): ahora siempre se devuelve lo que la persona escribió.
- *Mi prueba de reparto estaba mal planteada* (los pesos son también el tope de cada línea) y varias expectativas mías (código normalizado `0TR020`, subtotal tras dos fusiones, UPDATE bajo RLS afecta 0 filas, el admin no puede insertar la columna `id`): se corrigió la prueba, no el código.
- *Mutantes de la primera vuelta que sobrevivían* (10 de 68 en funciones y 4 de 23 en estructura): colección archivada, automático con tope por clienta o mínimo, cupón que deja de pedir código, fin propio del cupón, envío gratis con cupón tras los descuentos, `coupons_window`, índices únicos directos, privilegios de tabla y de columna. Cada uno llevó a una prueba nueva.
- *Localizadores del E2E del panel* (diálogo «Descuento creado», título «Se generaron 10 códigos») y un **ENOTFOUND transitorio** de DNS en la integración (se reintenta).
- *Capturas de pantalla del panel* (escritorio y móvil): la columna de acciones apilaba cuatro botones en uno (filas del doble de alto) y los códigos se partían a mitad de palabra: se corrigieron con un ancho mínimo y sin salto de línea.

**Revisión independiente (agente sin contexto, solo lectura; 10 hallazgos, ninguno crítico). Cada uno se verificó leyendo el código antes de actuar.**
- *Corregidos con prueba (y mutante detectado):*
  1. Un `2.0` escrito en un parámetro entero (válido para el `CHECK`; jsonb conserva la escala) hacía que `'2.0'::int` lanzara 22P02 y **rompiera la lectura de todos los carritos** mientras ese descuento estuviera activo. Solo alcanzable por API/SQL directo (el panel manda `2`). Ahora `::numeric::int`.
  2. **Cupón no acumulable con «no aplicar a rebajados»:** si el cupón ganaba, descartaba la oferta de las líneas que decía excluir (P1 100,00 con flash del 10 % y P2 200,00 con cupón del 20 %: 260,00 en vez de 250,00). Ahora no compiten y conviven.
  3. **Bolsa sin líneas cobrables:** `set_coupon` guardaba CUALQUIER texto como cupón (`not_applicable`) y bloqueaba otros intentos. Ahora un código inexistente, apagado, archivado o futuro sigue siendo `invalid_code` y no se guarda.
  4. Códigos que normalizan a 1–2 caracteres (`A--`, `1-0`) se aceptaban y se adivinan en decenas de intentos: `CHECK coupons_code_norm_len` (mínimo 4 al normalizar), replicado en el panel.
  5. El panel creaba el descuento y luego sus objetivos uno por uno: si fallaba uno quedaba **encendido con el alcance incompleto**. Ahora se deja apagado y lo avisa (y avisa fuerte si tampoco se pudo apagar).
  6. El motor contaba el historial de usos de todos los descuentos automáticos en cada lectura: ahora solo los que tienen algún tope.
  7. Mensajes: «sin bolsa» ya no dice «ese código no es válido» y el tope de intentos ya no dice «Probaste muchos códigos» (culpaba a quien compartía red). «Primera compra» arranca con tope de 1 por clienta en el asistente.
- *Documentados como límite u obligación de S10, NO corregidos* (`docs/descuentos.md`): las reservas `reserved` **no caducan** (S10 debe liberar al cancelar o vencer el pedido sin pagar); `discount_reserve` no revalida la elegibilidad de la clienta (dos pedidos simultáneos de primera compra sin tope por clienta; S10 debe serializar por clienta); el tope de intentos es por red (una IP de operadora puede bloquear a legítimas; no hay tope global por descuento); el alcance sin objetivos solo se valida en pantalla; los cupones de ejemplo son públicos en el repo.
- *Sin hallazgo:* redondeo y mayor resto (100 entre tres = 34/33/33, tope de 20 sobre el 50 % de 250 = 16 + 4), orden ofertas → cupón → envío, vigencia inicio inclusivo / fin exclusivo, candado de `discount_reserve` sin ciclos, `search_path` fijo y permisos mínimos en todas las funciones, RLS solo admin y sin DELETE, CSV que neutraliza `= + - @`, tabulador y retorno de carro, accesibilidad del campo de cupón.

**Verificación (2026-11-09):**
- **Unitarias:** 5424 en 230 archivos (S8: 4699 / 214), con tipos, lint `--max-warnings=0` y Prettier limpios. Una primera corrida completa dio **1 fallo que no se reprodujo** (se repitió la suite entera: 5424 de 5424; no se identificó cuál fue, probablemente un tiempo de espera bajo carga: el equipo corría mutaciones contra la nube a la vez).
- **pgTAP contra la nube** (con los datos de ejemplo cargados y la migración corregida aplicada): `16_s9_descuentos` **520 aserciones** (incluye un fuzz determinista de 400 carritos; eran 511 antes del hallazgo del E2E, ver más abajo), `05` 16, `06` 111, `14` 473, `15` 243, todas verdes y repetidas tras la última corrección. Los valores esperados están calculados **a mano** en el comentario de cada bloque (p. ej. 3 unidades en el tramo del 5 % de 250,00 = 12,50; 10,00 entre tres líneas = 3,34 + 3,33 + 3,33; P1 100 + P2 200 con flash 10 % y cupón 20 % excluyendo rebajados = 10 + 40 = 50, total 250,00).
- **Integración contra la nube:** `discounts.integration.test.ts` (7: cupón por la función real, reserva y candado con **dos sesiones**, 50 reservas simultáneas sobre un cupón de un uso → entra exactamente 1) y `cart` (34, 4 omitidas).
- **Mutación SQL:** primera vuelta 58 de 68 mutantes de funciones y 19 de 23 de estructura detectados; los supervivientes llevaron a pruebas nuevas y se repitieron. Tras la revisión: **20 mutantes nuevos de las correcciones (2.0, «no rebajados», bolsa vacía, usos) detectados**, más 5 antiguos reescritos y 1 de estructura (`coupons_code_norm_len`). Equivalentes que no se pueden detectar (se documentan, no se «matan»): `least` del tope en un reparto que ya está acotado y un término redundante del trigger de objetivos. El candado de `discount_reserve` se mutó **en la nube** (sin `for update`) y se restauró (2 `for update` presentes). Interfaz: mutantes del asistente, de la regla del código, del almacén y del cierre de objetivos (7 de 7 detectados en esta vuelta). Tras el hallazgo del E2E, **4 mutantes del arreglo del código canónico, los 4 detectados**: quitarlo de la rama general hace fallar 7 pruebas, quitarlo de la bolsa vacía (código y lista de rechazados) 1 + 1, y ensancharlo a motivos que no se guardan (filtraría la existencia de cupones) lo detecta la prueba de uniformidad que ya existía.
- **E2E contra la nube (Chromium escritorio y móvil):** `e2e/admin-discounts.spec.ts` (las tres pestañas con sus textos reales, el asistente crea un cupón del 12,5 % y la base lo guarda exactamente así, 10 códigos al azar, archivar) y los specs de carrito y envíos que toca el resumen de la bolsa. **Con la función `cart` ya desplegada**, `e2e/discounts.spec.ts` corrió por primera vez (aplicar y quitar `ejemplo-10`, código inexistente, cupón vencido, mínimo no alcanzado, recarga y accesibilidad AA a 360 px): **12 de 12 en escritorio y móvil**. Regresión de `cart` + `shipping` + `admin-discounts` tras la última corrección: **45 verdes, 1 omitida por diseño** (objetivos táctiles de móvil, que no aplica en escritorio).
- **Hallazgo del E2E (no lo habían visto ni las pruebas SQL ni las de componentes):** con un cupón guardado «con aviso» (mínimo no alcanzado, no aplica o no combinable) la bolsa mostraba el código **normalizado** (`EJEMPLO20` → `EJEMP1020`), porque el carrito guarda la forma normalizada y la foto la reevalúa. Corregido en `_discount_evaluate` (esos tres motivos devuelven el código canónico; el resto sigue devolviendo lo escrito) en las dos ramas (con líneas y bolsa vacía), con 9 pruebas pgTAP nuevas. Aplicado a la nube con ensayo previo revertido. También se arregló una prueba del E2E que reutilizaba un descuento ya archivado por la corrida anterior (un descuento archivado responde «código no válido», no «ya venció»).
- **CLS y capturas de `/carrito` con cupón guardado (al recargar):** móvil 0,0000; escritorio 0,0282. El de escritorio es **igual sin cupón** (0,0282 y 0,0284 en dos corridas), así que el cupón no añade desplazamiento; ese 0,028 es anterior y está bajo el umbral «bueno» (0,1). Capturas de escritorio y móvil revisadas a mano: precio tachado, descuento por línea y en el resumen, tarjeta «Tu cupón» con el código bien escrito.
- **Peso:** entrada pública gzip **258,5 kB** (`index` 73,9 + `App` 184,5; S8: 256,9; presupuesto ≤ 270); los textos del panel de descuentos van en el diccionario del panel, fuera de la entrada.
- **Capturas del panel revisadas a mano** (escritorio y móvil; lista, asistente, códigos, redenciones, grupos).

**Criterios de aceptación:**
1. *El admin crea cada uno de los 8 tipos sin código ni ayuda:* **cumplido en lo técnico** (una prueba del asistente crea los 8 y comprueba el `DiscountInput` exacto; el E2E crea uno real); **«sin ayuda» no está probado con la persona real**.
2. *Un solo cupón por pedido; los demás se rechazan con mensaje claro:* **cumplido** (`coupon_already_applied` en la bolsa, índice único por pedido y `one_coupon_per_order` al reservar).
3. *Límites de uso bajo concurrencia:* **cumplido** (candado de fila; 50 simultáneas y dos sesiones; el mutante sin candado se detecta).
4. *El servidor recalcula y manda:* **cumplido** (el cliente solo envía el código; no lee `coupons`; el contrato SQL↔TS está probado).
5. *Totales nunca negativos y a 2 decimales; coinciden entre carrito y pedido:* **cumplido hasta la bolsa** (propiedad en 400 carritos); «coinciden con el pedido» **es de S10**.

**Pendiente (no hecho / no verificado):**
- **Hecho el 2026-11-09:** la función `cart` (acciones `set_coupon` / `remove_coupon`) está desplegada en la nube (`functions deploy cart --use-api`, sin Docker), con el `SUPABASE_ACCESS_TOKEN` guardado en `.env.e2e`. **Ese token se pegó en el chat y debe revocarse al terminar** (Supabase → Account → Access Tokens); para el próximo despliegue se crea uno nuevo y se guarda solo en `.env.e2e`. Las otras 6 funciones no se redesplegaron (no cambiaron en S9).
- **Valores reales** de cupones y ofertas de lanzamiento (SPRINT_19 §N) y **decisiones del dueño**: orden con cupones no acumulables, «primera compra» por cuenta o por teléfono/dirección.
- **Navegador real y teléfono, lector de pantalla y Lighthouse:** no probados (el campo de cupón sí pasa axe y las revisiones de teclado/foco en componentes).
- **Código menor:** `TargetsPicker` consulta los productos por ids directamente; el conteo de miembros de un grupo se hace por fila; el reporte de redenciones muestra las últimas 1000.
- **S10 (obligaciones):** redefinir `_customer_order_count`, liberar las reservas al cancelar o vencer el pedido sin pagar, serializar por clienta y guardar el desglose por línea en el pedido (`lines[].discount_offers`) para el reembolso prorrateado de S12.
- **La migración se editó después de aplicarse** (revisión): la nube recibió los mismos cambios por un parche idempotente (`create or replace` de las funciones y la restricción `coupons_code_norm_len`); una base nueva construida desde los archivos queda igual. Verificado con pgTAP en la nube.
