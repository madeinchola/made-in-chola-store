# Canal de reclamos (Sprint 15)

Un formulario público para que cualquier persona —con o sin cuenta— presente un reclamo, con un **número de seguimiento**, un **plazo de respuesta** y una bandeja para el administrador. El enfoque legal general está en [legal.md](legal.md).

> **Pendiente de confirmar con un abogado:** si en Bolivia aplica un «libro de reclamaciones» con un formato oficial y cuál es el plazo de respuesta que corresponde. Hoy el plazo es de **10 días** (ajuste `complaints_response_days`, editable entre 1 y 60) y es provisional.

## Para la clienta: `/reclamos`

- Está en el pie de la tienda («Reclamos»). Campos: nombre, correo y/o teléfono (**basta uno**), número de pedido (opcional), tipo (producto, entrega, cobro o pago, atención, otro) y el detalle (de 20 a 2000 caracteres). Si tiene sesión, su nombre y correo ya vienen escritos y el reclamo **queda ligado a su cuenta**.
- Al enviar ve su **número** (`REC-000123`) y la **fecha límite** de respuesta (la que fija el ajuste). Se explica en palabras cada error y el foco va al primer campo con problema; el botón se bloquea mientras envía (no hay doble envío).
- **A quien reclama NO se le escribe automáticamente.** El formulario es público y el correo lo teclea cualquiera: escribirle sin verificarlo permitiría que alguien hiciera que la tienda le mande mensajes a un tercero (el mismo criterio que usamos desde S13 para los avisos de pedido, que van al contacto de la **cuenta**, no al del formulario). Por eso la confirmación es la pantalla con el número.

## Para el administrador: `/admin/reclamos`

- **Resumen** (nuevos, en revisión, vencidos y total) y una **bandeja** paginada de 50 en 50 con filtros **Abiertos** (por omisión), Todos, Respondidos y Cerrados. Lo pendiente va primero y lo más urgente arriba; lo **vencido** se marca con texto, no solo con color.
- Cada reclamo se abre para leerlo (el texto de quien reclama se muestra como **texto**, nunca como HTML), con los medios para contestar: **correo** (con el número del reclamo en el asunto), **WhatsApp** y **llamada**, solo con lo que dejó.
- Estados: **nuevo → en revisión → respondido → cerrado** (se puede reabrir). **«Respondido» exige escribir qué se contestó** (hasta 2000 caracteres): queda guardado con el reclamo, con la fecha y **quién lo atendió**. La respuesta la envías tú por el medio que prefieras: el sistema **no la envía**.
- **Alerta por correo a los administradores** cuando entra un reclamo (plantilla `complaint_new`, editable en Notificaciones → Plantillas). **No lleva datos de quien reclama** (solo el número y el tipo): el detalle se lee en el panel. Para que llegue hace falta lo mismo que para todos los avisos (proveedor de correo y destinatarios: `docs/notificaciones.md`).

## Protecciones

- La función `complaint` limita **5 reclamos por hora por red**, **10 por día por cuenta** y **300 por día en total**, y la base tiene su propio **cortafuegos** (si entran más de 100 reclamos en una hora se rechazan).
- Un **campo trampa** (`website`, invisible para las personas) hace que un robot reciba un «recibido» sin que se guarde nada, y aun así gasta su límite.
- El esquema es **estricto** (un campo de más —el estado, la cuenta, la fecha— se rechaza) y el cuerpo está limitado a **4 kB**. El texto se **limpia** (sin caracteres de control, correo en minúsculas, teléfono a E.164, pedido en mayúsculas) antes y después de llegar a la base.
- La tabla `complaints` **no se lee ni se escribe directo** (ni el administrador): solo las funciones. Se guarda la **huella de la red** (un HMAC, nunca la IP). La **auditoría** anota *que* cambió el contacto, el detalle o la respuesta, **no su valor** (datos personales).
- Los reclamos de una cuenta salen en «Descargar mis datos» (con lo que contó y la respuesta).

## Pruebas

pgTAP `25_s15_reclamos` (permisos, limpieza, cortafuegos, la alerta que no impide registrar, el orden y los filtros de la bandeja, la respuesta obligatoria y la auditoría sin datos personales), Deno (`complaint`: esquema, normalización, límites antes de guardar, el campo trampa), unitarias de la página pública y del panel, integración contra la función desplegada (los límites, el campo trampa, la sesión rota, los permisos de cada rol) y E2E (la visitante reclama y la administradora lo responde; accesibilidad y desbordes).

## Límites conocidos (nada de esto está escondido)

1. **El plazo de 10 días y el formato** son provisionales (ver el aviso de arriba).
2. **No hay correo automático a quien reclama** (decisión de seguridad); tampoco un seguimiento público «consulta tu reclamo con tu número».
3. **La respuesta se registra, pero la envías tú**: no sale de la tienda por correo ni por WhatsApp.
4. **No se adjuntan fotos** al reclamo (el detalle es solo texto).
5. **Un administrador ve los datos de contacto de todos los reclamos**; las descargas de reportes no quedan en la auditoría (ver `docs/reportes.md`).
6. **No hay estadísticas** de tiempo de respuesta ni reporte exportable de reclamos.
