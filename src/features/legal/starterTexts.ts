import type { LegalKind } from "./types";

/**
 * Textos de PARTIDA de los cinco documentos legales (Sprint 15). Los redactó el equipo de desarrollo, NO un abogado: sirven para no
 * empezar de una hoja en blanco y llevan dos marcas que impiden publicarlos sin haberlos leído y completado (el panel no deja
 * publicar mientras el texto contenga alguna). Los datos del negocio van como `{{razon_social}}`, `{{nit}}`, `{{direccion}}`,
 * `{{correo}}` y `{{telefono}}`: salen de Ajustes y se rellenan solos.
 */
export const DRAFT_MARKER = "BORRADOR SIN REVISIÓN LEGAL";
export const COMPLETE_MARKER = "[COMPLETAR";
/** Las marcas que bloquean la publicación mientras sigan en el texto. */
export const PENDING_MARKERS: readonly string[] = [DRAFT_MARKER, COMPLETE_MARKER];

/** Las marcas que todavía tiene un texto (para decirle al administrador qué falta). */
export function pendingMarkers(body: string): string[] {
  return PENDING_MARKERS.filter((marker) => body.includes(marker));
}

const NOTICE = `**${DRAFT_MARKER}: elimina esta línea cuando un abogado lo haya revisado y hayas completado los datos entre corchetes.**`;

const TERMS = `${NOTICE}

Estos términos regulan el uso de la tienda en línea de **{{razon_social}}** (NIT {{nit}}), con domicilio en {{direccion}}. Para consultas escríbenos a {{correo}} o al {{telefono}}.

# 1. Aceptación y cambios

Al crear una cuenta o al enviar un pedido declaras que leíste y aceptas estos términos y la política de privacidad. Cuando los cambiemos, publicaremos la versión nueva con su fecha de vigencia y te pediremos que la aceptes de nuevo antes de tu próxima compra. Los pedidos ya hechos se rigen por la versión que aceptaste.

# 2. Tu cuenta

- Debes ser mayor de edad, o contar con la autorización de tu representante legal, para comprar.
- Los datos que nos des (nombre, teléfono, correo, dirección) deben ser verdaderos y estar al día: los usamos para entregarte el pedido.
- Eres responsable de la seguridad de tu contraseña. Avísanos si crees que alguien más entró a tu cuenta.

# 3. Productos, precios y disponibilidad

- Los precios se muestran en la moneda indicada y, salvo que se diga otra cosa, incluyen impuestos. El costo de envío se calcula al pagar y se ve antes de confirmar.
- Las fotos son referenciales: el color puede variar según la pantalla.
- La disponibilidad es la que muestra la tienda al momento de pagar. Si un producto se agota o un precio cambia antes de que confirmes, te lo avisamos y puedes decidir si continúas.
- Si detectamos un error evidente de precio, podemos cancelar el pedido y devolverte lo que hayas pagado.

# 4. Pedidos y pago

- El pedido queda registrado cuando lo envías, y se confirma cuando verificamos el pago (o, en entrega con cobro, cuando se entrega).
- Si el pago no se confirma en el plazo indicado en tu pedido, podemos cancelarlo y liberar los productos.
- Medios de pago: los que aparezcan disponibles al pagar. No guardamos datos de tarjetas.
- Si necesitas factura, indícalo al hacer el pedido con tus datos fiscales.

# 5. Envíos y entrega

El costo, los plazos y las zonas de entrega están en la política de envíos. Revisa que la dirección y el teléfono sean correctos: una dirección equivocada o una entrega fallida por falta de contacto puede generar costos adicionales.

# 6. Cambios, devoluciones y reembolsos

Se rigen por la política de devoluciones y cambios, que forma parte de estos términos.

# 7. Propiedad intelectual

Las fotos, textos, marcas y diseños de la tienda son de {{razon_social}} o de quienes nos autorizaron a usarlos. No puedes copiarlos ni usarlos con fines comerciales sin nuestro permiso por escrito.

# 8. Responsabilidad

Hacemos lo posible por que la tienda esté siempre disponible, pero no garantizamos que no tenga interrupciones. No respondemos por daños indirectos, ni por demoras causadas por terceros o por hechos fuera de nuestro control, en la medida que la ley lo permita.

# 9. Reclamos

Si algo salió mal, escríbenos a {{correo}} o al {{telefono}} con tu número de pedido. [COMPLETAR: plazo de respuesta a reclamos y, si existe, enlace al canal de reclamos].

# 10. Ley aplicable

Estos términos se rigen por las leyes del Estado Plurinacional de Bolivia, incluidas las normas de protección a las consumidoras y los consumidores. [COMPLETAR: jurisdicción y foro, según indique el abogado].

# 11. Contacto

{{razon_social}} · NIT {{nit}} · {{direccion}} · {{correo}} · {{telefono}}
`;

const PRIVACY = `${NOTICE}

**{{razon_social}}** (NIT {{nit}}, {{direccion}}) es responsable de tus datos personales. Para ejercer tus derechos o resolver dudas escríbenos a {{correo}}.

# 1. Qué datos recogemos

- **Datos de tu cuenta:** nombre, correo y/o teléfono, y una contraseña que guardamos cifrada.
- **Datos de tus pedidos:** productos, importes, dirección y referencias de entrega, teléfono de contacto, y los datos fiscales (NIT o documento y razón social) si pides factura.
- **Pagos:** el medio de pago elegido y, si corresponde, el comprobante que nos envíes. No guardamos datos de tarjetas.
- **Datos técnicos:** un identificador técnico y de red (guardado de forma que no permite reconstruir tu dirección IP) para registrar tu aceptación de estos textos y proteger la tienda de abusos.
- **Uso del sitio:** solo si lo aceptas en el aviso de cookies, medimos cómo se usa la tienda (qué páginas se ven, qué se agrega a la bolsa) para mejorarla y para medir nuestra publicidad.

# 2. Para qué los usamos

- Procesar, entregar y dar seguimiento a tus pedidos, y emitir factura.
- Avisarte del estado de tu pedido por correo o WhatsApp.
- Atender tus consultas, cambios y reclamos.
- Prevenir fraudes y proteger la seguridad de la tienda.
- Cumplir obligaciones legales, contables y tributarias.
- Solo con tu consentimiento: analítica y publicidad (ver la política de cookies). No te enviamos promociones sin que lo aceptes.

# 3. Con quién los compartimos

Solo con quienes necesitamos para operar, y únicamente los datos necesarios:

- Proveedores de alojamiento y base de datos de la tienda.
- Proveedores de envío de correo electrónico.
- Transportistas o mensajeros, con tu nombre, dirección y teléfono, para entregarte el pedido.
- Autoridades, cuando la ley lo exija.
- [COMPLETAR: otros terceros, por ejemplo la facturación electrónica o los servicios de publicidad si activas analítica].

No vendemos tus datos.

# 4. Transferencias fuera de Bolivia

Algunos de nuestros proveedores pueden almacenar o procesar datos en servidores fuera de Bolivia. [COMPLETAR: países y salvaguardas, según indique el abogado].

# 5. Cuánto tiempo los conservamos

Mientras tengas cuenta y, después, el tiempo necesario para cumplir obligaciones legales, contables y tributarias, o para atender reclamos. [COMPLETAR: plazos concretos].

# 6. Tus derechos

Tienes derecho a conocer qué datos tenemos de ti, a corregirlos, a pedir que los eliminemos y a oponerte a ciertos usos, de acuerdo con la Constitución Política del Estado y la normativa vigente. Puedes pedir la eliminación de tu cuenta: conservaremos solo lo que la ley nos obliga a guardar (por ejemplo, el registro de ventas y la facturación). Escríbenos a {{correo}}; te respondemos [COMPLETAR: plazo].

# 7. Cookies

Usamos cookies y tecnologías parecidas. Las necesarias para que la tienda funcione siempre están activas; las de analítica y publicidad solo se activan si las aceptas, y puedes cambiar tu decisión cuando quieras. Más detalle en la política de cookies.

# 8. Menores de edad y datos sensibles

La tienda no está dirigida a menores de edad. No pedimos datos sensibles (salud, ideología, religión u otros); por favor no los escribas en los campos libres de tu pedido.

# 9. Seguridad

Aplicamos medidas técnicas y de organización para proteger tus datos (conexión cifrada, acceso restringido, contraseñas cifradas). Ningún sistema es infalible: si ocurriera un incidente que te afecte, te lo informaremos.

# 10. Cambios a esta política

Si la cambiamos, publicaremos la versión nueva con su fecha de vigencia y te pediremos que la aceptes de nuevo.
`;

const COOKIES = `${NOTICE}

Esta política explica qué cookies y tecnologías parecidas usa la tienda de **{{razon_social}}** y cómo puedes elegir cuáles aceptar.

# 1. Qué son

Las cookies son pequeños archivos que el navegador guarda cuando visitas un sitio. Sirven para recordar tu sesión, tu bolsa o tus preferencias, y para medir cómo se usa el sitio.

# 2. Qué categorías usamos

- **Necesarias (siempre activas):** mantienen tu sesión iniciada, recuerdan tu bolsa de compras y guardan tu elección de cookies. Sin ellas la tienda no funciona, por eso no se pueden desactivar.
- **Analíticas (solo si las aceptas):** nos ayudan a entender qué páginas se visitan y dónde se abandona la compra, de forma agregada.
- **Marketing (solo si las aceptas):** permiten medir y mejorar nuestra publicidad en redes sociales y mostrarte anuncios más relevantes.

Hasta que aceptes las analíticas o las de marketing, **no se carga ninguna herramienta de terceros** para ese fin.

# 3. Cómo cambiar tu decisión

La primera vez que entras te mostramos un aviso para elegir. Puedes cambiar tu decisión cuando quieras desde "Preferencias de cookies" en el pie de página. Si retiras tu consentimiento, dejamos de usar esas herramientas y borramos lo que habíamos guardado.

También puedes borrar o bloquear las cookies desde la configuración de tu navegador; si bloqueas las necesarias, partes de la tienda (como la bolsa o el inicio de sesión) dejarán de funcionar.

# 4. Terceros

Si aceptas las analíticas o el marketing, los proveedores de esas herramientas pueden recibir datos de uso de tu navegador. [COMPLETAR: lista de proveedores activados, por ejemplo Google Analytics y Meta, con el enlace a su política].

# 5. Más información

Escríbenos a {{correo}}. Lee también nuestra política de privacidad.
`;

const SHIPPING = `${NOTICE}

Aquí explicamos cómo y cuándo te llega tu pedido. Los costos exactos de tu pedido los ves al pagar, antes de confirmar.

# Dónde entregamos

[COMPLETAR: ciudades y zonas de entrega, y qué pasa con el resto del país].

# Formas de recibir tu pedido

- **Entrega a domicilio:** en la dirección que indiques. El costo depende de la zona y se calcula al pagar.
- **Recojo en el taller:** sin costo de envío. [COMPLETAR: dirección, horario y qué debes presentar al recoger].

# Plazos

[COMPLETAR: cuánto tarda en prepararse un pedido y cuánto tarda la entrega, por zona].

Si eliges una franja horaria de entrega, hacemos lo posible por respetarla, pero puede variar por tráfico o clima.

# Pago contra entrega

[COMPLETAR: en qué zonas existe, y si hay un monto máximo].

# Si no estás para recibirlo

Te contactamos por teléfono o WhatsApp. [COMPLETAR: cuántos intentos hacemos y qué pasa después, incluido si el reenvío tiene un costo].

# Seguimiento

Te avisamos por correo o WhatsApp cuando tu pedido se confirma, se empaca, sale a la entrega y se entrega. Si tienes dudas escríbenos a {{correo}} o al {{telefono}} con tu número de pedido.
`;

const RETURNS = `${NOTICE}

Queremos que estés contenta con tu compra. Esta es la política de devoluciones, cambios y reembolsos de **{{razon_social}}**.

# Plazo

Puedes pedir un cambio o una devolución dentro de [COMPLETAR: número de días] días de haber recibido tu pedido.

# Condiciones

- La prenda debe estar sin usar, sin lavar y con sus etiquetas.
- [COMPLETAR: productos que no admiten cambio o devolución, por ejemplo ropa interior o artículos en liquidación].
- Si el producto llegó con una falla de fabricación o es distinto de lo que pediste, lo cambiamos o te devolvemos el dinero sin costo para ti.

# Cómo pedirlo

Escríbenos a {{correo}} o al {{telefono}} con tu número de pedido y cuéntanos qué pasó. Te respondemos [COMPLETAR: plazo] y te indicamos cómo enviarlo o entregarlo.

# Cambios

Puedes cambiar por otra talla o color según disponibilidad. [COMPLETAR: quién paga el envío del cambio].

# Reembolsos

Si corresponde un reembolso, lo hacemos por el mismo medio con el que pagaste, o por el que acordemos contigo, en un plazo de [COMPLETAR: días] días desde que recibimos y revisamos el producto. [COMPLETAR: si el costo de envío se reembolsa].

# Pedidos cancelados antes de la entrega

Si cancelas un pedido antes de que salga a la entrega, te devolvemos lo pagado.
`;

export const STARTER_TEXTS: Record<LegalKind, string> = {
  terms: TERMS,
  privacy: PRIVACY,
  cookies: COOKIES,
  shipping: SHIPPING,
  returns: RETURNS,
};
