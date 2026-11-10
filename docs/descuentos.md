# Descuentos y cupones (Sprint 9)

Qué hace, cómo está hecho y por qué. Cubre BR-PRC-03 (un solo cupón por pedido), BR-PRC-07 (los tipos de descuento) y deja la base para BR-PRC-04 (reembolso: S12) y para el pedido (S10).

> **Los valores de ejemplo son PROVISIONALES.** El dueño todavía no definió los cupones de lanzamiento (`PENDIENTES_ADMIN §F`). El bloque «Descuentos (S9)» de `supabase/seed.sql` carga unos cupones de ejemplo marcados «(ejemplo)»; se reemplazan desde `/admin/descuentos`. Nada está fijado en el código.

## En una frase

El servidor calcula todos los descuentos con un **motor determinista** (`_discount_evaluate`) que no escribe nada; un cliente solo puede **probar un código** a través de la función `cart` (con tasa limitada) y nunca lee la tabla de cupones; los **usos se reservan de forma atómica** al crear el pedido.

## Los ocho tipos

| Tipo | Qué hace | ¿Pide código? |
| --- | --- | --- |
| `percent` | Porcentaje (0, 100], con tope opcional de monto | Siempre |
| `fixed` | Monto fijo, repartido entre las líneas elegibles | Siempre |
| `free_shipping` | Envío gratis sobre un monto (mínimo opcional) | Elige el admin |
| `bogo` | «Llévate N, paga M» (2×1, 3×2…) por producto, categoría o colección | Nunca (automático) |
| `volume` | Porcentaje por tramos de cantidad (desde 3 unidades 5 %, desde 6 un 10 %…) | Nunca |
| `group_price` | Porcentaje para un grupo de clientas | Nunca |
| `flash` | Porcentaje con inicio y fin OBLIGATORIOS | Nunca |
| `first_purchase` | Porcentaje en la primera compra | Elige el admin |

Los parámetros de cada tipo van en `params` (jsonb) y los valida un `CHECK` (`_discount_params_valid`). Las combinaciones que no tienen sentido (porcentaje sin código, N×M sobre «todo el pedido», una oferta flash sin fechas…) las rechaza la base, no solo la pantalla.

## Orden de cálculo (determinista)

1. **Ofertas automáticas.** Por línea gana la que más baja (empate: mayor `priority` y luego menor `id`): **nunca dos sobre la misma línea**.
2. **El cupón** (uno solo por pedido). Si el descuento `stackable_with_automatic`, se aplica sobre lo ya rebajado. Si no, se aplica **la mejor de las dos opciones** para el pedido entero: gana el cupón solo si baja **más** que las ofertas (en empate ganan las ofertas y el cupón **no gasta su uso**). `exclude_sale_items` deja al cupón fuera de las líneas que ya tienen una oferta, y entonces **no compiten**: el cupón (acumulable o no) baja las otras líneas y las ofertas se **conservan** donde estaban (quitarlas sería tocar esas líneas). El mínimo del cupón se mide sobre lo que queda tras esas ofertas.
3. **Envío gratis.** El umbral se evalúa **después** de los descuentos (210,00 − 10 % = 189,00 no llega a 200,00). Si el cupón es de envío gratis pero ya hay envío gratis automático, el cupón se rechaza «no combinable» y no se gasta.

**Redondeo:** los importes se manejan en la unidad menor de la moneda (enteros), así que no hay errores de coma flotante. Se **redondea por línea** y la suma es exacta (33,33 + 33,33 + 33,34 al 10 % → 3,33 + 3,33 + 3,33 = 9,99, no 10,00). Un monto fijo se reparte entre las líneas con el **método del mayor resto** (10,00 entre tres líneas iguales: 3,34 + 3,33 + 3,33). Medio centavo se redondea hacia arriba.

**Garantías:** ninguna línea baja más de lo que vale, el descuento nunca supera el subtotal y el total nunca es negativo (una prueba de propiedades lo comprueba en 400 carritos al azar, con tres invariantes más: determinismo, la suma de los descuentos de línea y el mismo resultado al invertir el orden de las líneas).

**N×M:** las unidades elegibles se ordenan de la más cara a la más barata, se arman grupos de N seguidos y en cada grupo se regalan las (N − M) más baratas. Con cantidad impar (3 unidades al 2×1) solo se completa un grupo.

## Cupones (códigos)

- Un código se guarda como lo escribió el admin (de 4 a 32 caracteres, letras sin tilde, números y guion; **al normalizar deben quedar al menos 4**, así que `A--` o `1-0` no se aceptan: se adivinarían en decenas de intentos) y se compara **normalizado**: mayúsculas, sin espacios, guiones ni guion bajo, y con los caracteres que se confunden unificados (**O→0, I→1, L→1**). `verano-10`, `VERANO 10` y `VERAN0 1O` son el mismo código, y la base no deja crear dos que normalicen igual.
- Un cupón tiene vigencia propia opcional (**inicio inclusivo, fin exclusivo**, en instantes absolutos: la pantalla los muestra en hora de La Paz) y un **tope de usos propio** (1 = código de un solo uso, para lotes).
- El admin puede **generar códigos aleatorios** (hasta 500 por tanda; alfabeto sin 0, O, 1, I, L) con prefijo y largo a elección.

### Lo que NO se filtra

Un código **inexistente, apagado, archivado o que aún no empieza** recibe exactamente la **misma respuesta** (`invalid_code`), con lo que la persona escribió (no el código guardado: una mayúscula distinta lo delataría). Los motivos específicos (vencido, agotado, «ya usaste este cupón», mínimo no alcanzado…) solo salen para códigos que existen: quien los lee ya conoce el código. **Excepción deliberada:** con los tres motivos con los que el carrito *guarda* el cupón (`min_not_reached`, `not_applicable`, `not_combinable`) se devuelve el código **canónico** (el que guardó el admin), no lo escrito. El carrito guarda el código normalizado (`EJEMPLO20` → `EJEMP1020`) y la foto lo vuelve a evaluar; sin esta excepción la clienta vería `EJEMP1020` en su bolsa. No filtra nada nuevo: esos motivos solo existen para un cupón vigente. Los demás rechazos (`expired`, `sold_out`, `login_required`…) siguen devolviendo lo escrito. La Edge Function limita los intentos (12 por persona y 60 por red cada 10 minutos, acierte o no).

| Motivo | Qué dice la clienta |
| --- | --- |
| `invalid_code` | Ese código no es válido |
| `expired` | Ya venció |
| `wrong_currency` | No vale para la moneda de tu bolsa |
| `login_required` | Inicia sesión (cupones con tope por clienta, de primera compra o de grupo) |
| `sold_out` | Ya se agotó |
| `already_used` | Ya usaste este cupón |
| `not_first_purchase` | Solo para la primera compra |
| `not_eligible_customer` | No está disponible para tu cuenta |
| `not_applicable` | No aplica a los productos de tu bolsa (solo para un código que existe y está vigente: con una bolsa sin líneas cobrables un código inexistente sigue siendo `invalid_code` y no se guarda) |
| `min_not_reached` | Te faltan Bs X |
| `not_combinable` | Ya tienes una oferta mejor |
| `coupon_already_applied` | Ya hay un cupón en la bolsa (hay que quitarlo antes) |

## Usos atómicos

`discount_reserve(owner_type, owner_id, profile_id, applied)` reserva **todos o ninguno** de los descuentos que el motor devolvió en `applied`. Toma el **candado de la fila** de cada descuento y de cada cupón (en orden de id: sin ciclos) y cuenta con la fila ya bloqueada, así que bajo concurrencia no se pasa de ningún límite (una prueba con dos sesiones, la primera sin confirmar, demuestra que el candado es real; otra lanza 50 pedidos simultáneos sobre un cupón con un uso y entra exactamente 1). Es **idempotente** por dueño, **revalida** la vigencia y los topes (el cupón pudo vencer mientras la persona completaba el pago) y rechaza un segundo cupón en el mismo pedido (`one_coupon_per_order`). `discount_commit` confirma (`applied`) y `discount_release` devuelve (`reverted`: S12 al cancelar). Solo las ejecuta `service_role`.

## En la bolsa

La foto del carrito (`_cart_snapshot`) trae por línea `discount`, `final_total` y `discount_offers`; en los totales, `discount` (null si no hay) y `total` **ya descontado**; y `discounts` con lo aplicado, lo rechazado, el estado del cupón y `free_shipping`. El cupón se guarda en `carts.coupon_code` (normalizado) y se reevalúa en cada lectura: si deja de valer se avisa, y si vuelve a valer (p. ej. se alcanza el mínimo) se aplica solo. Se guarda aunque hoy no baje nada cuando la causa puede cambiar (mínimo no alcanzado, productos a los que no alcanza, mejor oferta ya aplicada); un código inexistente, vencido, agotado o que no corresponde a la clienta **no se guarda**. Al fusionar el carrito de un invitado con el de la cuenta, el cupón del invitado pasa a la cuenta si esta no tenía uno.

## Contrato para S10 (checkout) y S12 (reembolso)

- El pedido **recalcula siempre en el servidor**: `apply_discounts(cart_id, coupon_code, shipping)` (solo `service_role`) devuelve `{lines, applied, rejected, coupon, free_shipping, totals}` con el envío ya cotizado. Con `p_coupon_code = null` usa el cupón guardado; con `''`, ninguno.
- Después, `discount_reserve` con la lista `applied`. Si falla, el checkout avisa con el motivo (`sold_out`, `expired`…) y recalcula.
- **Primera compra:** `_customer_order_count(profile_id)` hoy devuelve 0 (no hay pedidos); **S10 debe redefinirla** contando los pedidos no cancelados de la clienta.
- Hay que **guardar el desglose por línea** en el pedido (snapshot) para el reembolso prorrateado de S12: `lines[].discount_offers` ya lo trae.

## Lo que debe hacer S10 con los usos (hallado en la revisión)

- **Las reservas `reserved` no caducan.** Un pedido abandonado consume un uso de `usage_limit_total` o de un cupón de un solo uso hasta que alguien llame a `discount_release`: S10 debe **liberar al cancelar o vencer el pedido sin pagar** (no solo S12 al reembolsar).
- **`discount_reserve` revalida vigencia y topes, pero no la elegibilidad de la clienta** (primera compra, grupo). Con `_customer_order_count` en 0 hoy no importa; cuando S10 la redefina, dos pedidos simultáneos de una clienta con un descuento de primera compra **sin** `usage_limit_per_customer` podrían pasar los dos: S10 debe **serializar por clienta** (candado de su fila de `profiles`) o `discount_reserve` debe revalidar. Mientras tanto, un descuento de primera compra debe llevar tope de **1 por clienta** (el de ejemplo lo lleva).

## Límites conocidos y decisiones abiertas

1. **Un descuento vale para UNA moneda** (`discounts.currency`); hoy solo existe BOB. Para otra moneda se crea otro descuento.
2. **«Primera compra» por cuenta:** quien abra otra cuenta con otro correo vuelve a ser «primera compra» (el sprint propone criterio por teléfono o dirección, para S12 o la lista negra).
3. **Cupón que no se acumula + ofertas:** se aplica la mejor opción para el pedido entero, no por línea (un cupón que gana descarta también las ofertas de las líneas que a él no le tocan). Es predecible y está documentado; si el dueño prefiere «por línea», cambia el motor.
4. **Un código que existe se delata con un motivo específico** (vencido, agotado…): es lo que pide el sprint («mensajes específicos de rechazo») frente a la «respuesta uniforme»; se mitiga con los topes de intentos y con códigos aleatorios de ≥ 6 caracteres (31 símbolos). Los códigos cortos o fáciles de adivinar que escriba el admin a mano siguen siendo adivinables con paciencia dentro del tope.
5. **Banner de oferta flash con cuenta regresiva:** los diseños (`docs/diseno`) no lo incluyen; **no se hizo**. La única mención de descuentos en el diseño es «10 % OFF en tu primera compra» (el banner superior): se puede cubrir con un descuento `first_purchase` y el banner de noticias existente.
6. **Redenciones sin límite de edad:** el reporte muestra las últimas 1000; para más, filtrar por descuento.
7. **Topes de intentos por IP:** los 60 intentos por 10 minutos son por red. Detrás de una IP compartida (operadoras móviles) un pico de campaña puede bloquear a clientas legítimas, y el texto ya no las culpa («Hubo demasiados intentos desde tu conexión»). Los códigos de 6 caracteres que genera el panel (≈ 8,9·10⁸ combinaciones) son adivinables con muchas IP en campañas grandes: usar 8 o más y un tope de usos. **No hay tope global por descuento.**
8. **El alcance se valida solo en la pantalla.** «Producto, categoría o colección» sin ningún objetivo lo acepta la base (el objetivo es otra tabla que se llena después) y el descuento no aplicaría a nada. El panel crea el descuento y luego agrega los objetivos uno por uno: si falla alguno, **lo deja apagado** y lo avisa (si tampoco puede apagarlo, lo dice fuerte).
9. **El nombre del descuento lo ve la clienta** («Oferta: {nombre}» en la bolsa): el asistente lo avisa junto al campo. Los cupones de EJEMPLO (`EJEMPLO10`, `EJEMPLO20`) no tienen topes y el repositorio es público: **no deben llegar a la tienda real** (la entrega vacía la base con `--no-seed`).
10. **Rendimiento:** el motor cuenta el historial de usos solo de los descuentos que tienen algún tope; la lectura de la bolsa evalúa cada descuento automático activo. Sin medir con miles de descuentos o de redenciones.
