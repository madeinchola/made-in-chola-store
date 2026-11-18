# Textos legales y datos personales (Sprint 15)

Qué hace, cómo está hecho y por qué. Cubre BR-LEG-01 (aceptación y consentimiento), BR-ACC-07 (datos propios) y el pedido del sprint de dejar la tienda lista para operar legalmente. Las cookies y la analítica están en [analytics.md](analytics.md) y los reclamos en [reclamos.md](reclamos.md).

> **Importante.** Los textos de partida los redactó el equipo de desarrollo, **no un abogado**. La tienda no deja publicarlos sin haberlos leído y completado (ver «Cómo se evita publicar un borrador»). La revisión legal es una tarea tuya (`SPRINT_19_Acciones_Manuales.md` §T).

## Los cinco documentos

| Documento | Dirección | Se acepta al registrarse y pagar |
| --- | --- | --- |
| Términos y condiciones | `/legal/terminos` | Sí |
| Política de privacidad | `/legal/privacidad` | Sí |
| Política de cookies | `/legal/cookies` | No (informativo) |
| Envíos | `/legal/envios` | No |
| Devoluciones y cambios | `/legal/reembolsos` | No |

Los cinco están en el pie de la tienda. Mientras un documento no tiene una versión publicada, su página dice «Este documento todavía no está publicado», no se indexa y no se exige aceptarlo: **la tienda funciona igual que antes hasta que publiques los primeros textos**.

## Versiones, vigencia y qué cambia al publicar

- Cada documento tiene **versiones** numeradas (1, 2, 3…). Hay a lo sumo **un borrador** por documento; al **publicarlo** pasa a ser una versión **inmutable** (la base impide cambiarla o borrarla, también al administrador). Un cambio es siempre una versión nueva.
- **Vigente** = la última versión publicada cuya fecha de vigencia ya llegó. Se puede publicar con una **fecha futura** («rige desde el lunes»); no se puede publicar con una fecha en el pasado.
- Desde la **segunda versión** hay que decir **qué cambió** (una nota corta): es lo que ve la clienta cuando le pedimos que acepte de nuevo.
- El texto es **texto con unas pocas marcas** (títulos con `#`, listas, **negrita**, enlaces `https://`, `http://` o `mailto:`), nunca HTML: la base rechaza las etiquetas al guardar y la tienda lo arma como elementos de React (no existe forma de colar un script). Los datos del negocio se escriben como `{{razon_social}}`, `{{nit}}`, `{{direccion}}`, `{{correo}}` y `{{telefono}}` y salen de **Ajustes** (nombre del negocio, NIT, dirección legal, correo y teléfono de contacto).

## Qué se exige y cuándo

- **Registro** y **pago** mandan la versión vigente de cada texto que exige aceptación (`legal_terms`, `legal_privacy`). El servidor compara con lo vigente: si falta uno → `409 legal_required`; si cambió mientras la persona leía → `409 legal_outdated` (la pantalla vuelve a pedir la casilla con la versión nueva).
- La casilla vale **solo para las versiones que la persona tenía delante** al marcarla: si un texto cambia después, la casilla se desmarca sola. Los enlaces se abren en otra pestaña para no perder lo escrito.
- Lo aceptado se **registra solo cuando la cuenta o el pedido SE CREARON** (una vista previa, un total que cambió o un reintento con la misma llave no dejan nada ni duplican). Cada registro guarda **texto, versión, fecha, contexto** (registro, pago o «aceptó de nuevo») y la **huella de la red**: un HMAC de la dirección IP con una clave del servidor, **nunca la IP**. La tabla es **inmutable** (ni el administrador ni el servicio la modifican); lo único que se permite es quitar la huella al **anonimizar una cuenta** (BR-ACC-07).
- Quien ya tenía cuenta cuando se publica una versión nueva ve un aviso (**«Actualizamos nuestros textos legales»**) con lo que cambió y enlaces a los textos: puede **aceptar** o dejarlo para después. «Ahora no» solo lo cierra mientras dure la visita: el pago lo vuelve a exigir, así que nadie compra sin aceptar lo vigente. El aviso **no se abre en el pago** (ahí ya está la casilla y taparía el formulario). Para quien tenía cuenta antes de que existieran los textos es la primera vez, no un cambio; por eso el texto dice «si algo cambió, aquí te lo contamos».
- Aceptar de nuevo puede ser **solo una parte** de lo vigente (si solo cambiaron los términos no se le vuelve a pedir la privacidad) y se anota **únicamente lo que la persona vio**.

## El panel: `/admin/legal`

- **Lista** de los cinco documentos con su versión vigente, si hay un borrador y qué datos del negocio faltan en Ajustes.
- **Editor** de cada documento: parte del borrador, de la última versión (para escribir la siguiente) o —si no hay ninguna— del **texto de partida**; **vista previa** tal como la verá la clienta (con los datos de Ajustes); guardar borrador, descartarlo, **publicar** (desde ahora o desde una fecha, hora de La Paz, con la nota de qué cambió) e **historial** con el estado de cada versión (borrador, programada, vigente, reemplazada), su texto, «usar como base» y cuántas cuentas y pedidos aceptaron cada una.
- Avisa antes de perder cambios sin guardar y **no deja publicar con cambios sin guardar**.

### Cómo se evita publicar un borrador

No se puede publicar un texto que todavía tenga:

1. la marca **`BORRADOR SIN REVISIÓN LEGAL`** (la primera línea de cada texto de partida),
2. algún **`[COMPLETAR…]`** (los datos que debe decidir el negocio: plazos, zonas, políticas),
3. una **variable que no existe** (`{{razon}}`: error de tipeo) o
4. una **variable del negocio sin dato** (por ejemplo `{{nit}}` mientras el NIT esté vacío en Ajustes).

Para publicar hay que quitar la marca de borrador (es decir, haber leído y aprobado el texto) y completar lo que falta. **El sistema no puede saber si el texto es correcto**: solo impide publicar por descuido.

## Datos personales a solicitud (BR-ACC-07)

- **Descargar mis datos** (`/cuenta/seguridad`): un archivo JSON con todo lo que la tienda guarda de la persona: perfil, direcciones, datos fiscales, pedidos (con sus líneas, cobros e historial de estados), lo que aceptó (texto, versión y fecha, **sin** la huella de red), preferencias de avisos y reclamos. La base lo arma con `my_data_export()`, que **solo devuelve lo de quien la llama** y **nunca** el costo de los productos, la llave de idempotencia, la huella de red, el rol interno ni nada de otras personas. El archivo se guarda en el navegador: no queda en ningún servidor ni en ningún enlace.
- **Eliminar / anonimizar**: ya existía desde S6 («Desactivar mi cuenta», con la opción de anonimizar): se conservan los pedidos y sus datos contables, y al anonimizar se quita la huella de red de lo aceptado.

## Lo que hay que saber de cómo está hecho

- Tablas `legal_documents`, `legal_versions` y `legal_acceptances`: **nadie las lee ni las escribe directo** (ni el administrador, ni el servicio); solo las funciones, que se autorizan por dentro. La lectura pública (`public_legal_document`, `public_legal_index`, `public_legal_required`) devuelve **solo lo vigente y publicado**: ni borradores ni versiones futuras.
- `record_legal_acceptance` es solo del servicio (las funciones `register`, `checkout` y `legal-accept`). `legal-accept` y las otras dos validan con zod (`legal_terms` y `legal_privacy` son enteros positivos sueltos: la petición del pago es estricta y de 2 kB).
- Migración `20261118000100_s15_legal.sql` y `…0400_s15_mis_datos.sql`; pgTAP `23_s15_legal` y `26_s15_mis_datos`.

## Límites conocidos (nada de esto está escondido)

1. **Los textos no están revisados por un abogado** ni completos (los `[COMPLETAR…]`). Hasta entonces no se publican.
2. **El plazo de conservación, las transferencias fuera de Bolivia y los terceros** de la política de privacidad están por decidir (`[COMPLETAR…]`).
3. **No hay un «libro de reclamaciones» con formato oficial**: hay un canal de reclamos propio ([reclamos.md](reclamos.md)). Si la normativa exige un formato, lo dirá el abogado.
4. **El consentimiento de cookies vive en el navegador** (no en el servidor): un visitante anónimo no tiene cuenta donde guardarlo. La aceptación de términos y privacidad **sí** se guarda en el servidor.
5. **Quien ya aceptó una versión no vuelve a verla en su historial** desde la cuenta: el archivo «Descargar mis datos» la incluye, pero no hay una pantalla «Mis aceptaciones».
6. **La descarga de datos es de todo o nada** y está limitada por el tiempo de la base (8 s): una cuenta con decenas de miles de pedidos no cabría. Con las cuentas de una tienda de este tamaño no es un problema.
7. **Textos en otro idioma o para otro país** no están (S18).
