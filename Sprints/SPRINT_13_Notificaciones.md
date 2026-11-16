# Sprint 13 — Notificaciones y alertas

**Release:** R3 · **Estimación:** 4 días · **Depende de:** S10 y S12 (eventos de pedido en `notification_outbox`), S3 (alertas de stock)

## Objetivo
Entregar de forma fiable, por **email y/o WhatsApp**, las notificaciones transaccionales (confirmado, empacado, enviado, entregado), las de seguridad de cuenta y las alertas internas (stock bajo, pagos por revisar), con reintentos y sin bloquear nunca la operación.

## Alcance
**Dentro:** worker del outbox, proveedor de email (D-03), canal WhatsApp (API oficial o enlace manual), plantillas con marca, preferencias de canal, reintentos/backoff, alertas internas, registro y panel de entregas.
**Fuera:** marketing masivo/newsletter, recuperación de carritos (descartado), campañas.

## Reglas de negocio cubiertas
BR-SHP-04, BR-INV-05 (correo), BR-MKT-01, BR-LEG-01 (consentimiento marketing vs. transaccional), D-03.

## Tareas

### BD
- [x] Completar `notification_outbox` (la crea S3 con tipo, canal, destinatario, `payload`, estado `pending|sent|failed`, intentos, `next_retry_at` y `dedupe_key` único; aquí se añaden `template`, `sent_at`, error y los estados `sending|dead`).
- [x] `notification_templates` (clave, canal, idioma, asunto, cuerpo con variables, activo) editables por admin con vista previa y valores de ejemplo.
- [x] `notification_preferences` (por cliente: canal preferido, consentimiento) y valores por defecto de la tienda.
- [x] Triggers/función que encolan eventos de estado: **confirmado, empacado (`preparing`), enviado, entregado**, además de cancelación/reembolso, pago recibido/rechazado, comprobante rechazado.
- [x] Alertas internas: stock bajo/crítico (dedupe por variante/umbral), pagos por revisar, pedidos antiguos sin confirmar, errores de webhook.

### Edge Functions
- [x] `notify-worker` (invocado por cron cada minuto + `pg_net`/webhook al encolar): toma lotes con `FOR UPDATE SKIP LOCKED`, envía, marca estado, aplica backoff exponencial y pasa a `dead` tras N intentos con alerta.
- [x] Proveedor de **email** (Resend/Postmark/SMTP — D-03): dominio propio con **SPF, DKIM y DMARC** configurados; plantillas HTML responsivas con la identidad de la diseñadora + texto plano. **Hecho el adaptador de Resend** (contrato verificado en su documentación) y el diseño responsivo con modo oscuro; **falta** la cuenta, el dominio y la identidad definitiva de la diseñadora.
- [x] Canal **WhatsApp**: API oficial (plantillas aprobadas) **o** modo manual con enlace `wa.me` generado en el panel (decisión pendiente); fallback entre canales según preferencia. **Hecho el modo manual** (enlace `wa.me` con el mensaje ya escrito y «Ya lo envié»); la API oficial **no existe** (decisión y costo pendientes del dueño). El fallback entre canales sí: la preferencia elige entre los medios que la clienta tiene.
- [ ] Reutilizar patrones de Acrosoft (`notify-stock-alert`, `send-*`, reintentos de WhatsApp) tras revisarlos. **No se hizo:** no hay acceso a ese código desde este repositorio; el diseño se escribió desde el contrato del proveedor.
- [ ] Emails de Auth (confirmación/recuperación) con SMTP propio y plantillas de marca. **No se hizo:** se configura en el panel de Supabase Auth con el dominio verificado (SPRINT_19 §R); estos correos no usan las plantillas del panel.

### Admin
- [x] Editor/preview de plantillas; envío de prueba.
- [x] **Registro de notificaciones** por pedido/cliente (estado, error, reenviar manualmente).
- [x] Configuración de destinatarios de alertas internas (los 2 admins) y de umbrales de ruido.

### Cliente
- [x] Preferencias de notificación en la cuenta; enlace de baja solo para marketing (los transaccionales no se pueden desactivar).

## Criterios de aceptación
1. Cada cambio de estado relevante genera exactamente **una** notificación por canal elegido (sin duplicados).
2. Si el proveedor falla, el pedido no se afecta; se reintenta y, agotados los intentos, se alerta al admin.
3. Alertas de stock llegan al/los admin una vez por cruce de umbral (sin spam).
4. Los correos llegan a bandeja de entrada (no spam) y se ven bien en Gmail/Outlook/Apple Mail móvil.
5. El admin puede reenviar manualmente cualquier notificación y ver su historial.

## Testing
- **Unit:** render de plantillas (variables faltantes, caracteres especiales, XSS en nombres/direcciones), cálculo de backoff, `dedupe_key`.
- **Integración:** worker con proveedor *fake* (éxito, error transitorio, error permanente, timeout); `SKIP LOCKED` con dos workers en paralelo (sin doble envío).
- **E2E:** recorrer estados de un pedido y verificar mensajes en un buzón de prueba (Mailpit/Inbucket local); alerta de stock al bajar de umbral.
- **Entregabilidad:** prueba con mail-tester / Gmail postmaster; verificación SPF/DKIM/DMARC.
- **Resiliencia:** caída del proveedor 1 hora → recuperación sin pérdidas ni duplicados.
- **Privacidad:** el contenido no incluye más datos de los necesarios; enlaces de pedido requieren sesión.

## Edge cases
- Cliente sin email (solo teléfono) → canal WhatsApp o aviso en pantalla; cliente sin teléfono → solo email.
- Email rebotado/inválido, buzón lleno, número de WhatsApp sin la app o fuera de ventana de 24 h (plantillas aprobadas).
- Eventos rápidos consecutivos (paid→preparing→shipped en segundos): orden y consolidación.
- Estado revertido por error del admin (deshacer): no enviar notificaciones engañosas; mensaje de corrección opcional.
- Cambio de dirección de email/teléfono entre encolar y enviar.
- Idioma/moneda del cliente en plantillas; formato de fechas en `America/La_Paz`.
- Plantilla desactivada o con error de sintaxis → fallback seguro y alerta.
- Límites de envío del proveedor (rate limit) y picos por campaña.
- Doble disparo del trigger (reintento de transacción) → `dedupe_key`.
- Mensajes muy largos (WhatsApp), emojis, caracteres no soportados.
- Desactivación de cuenta con notificaciones pendientes → cancelar/anonimizar.
- Admin con correo caído: ¿a quién escalar? (segundo admin).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de cumplimiento (consentimiento y transaccional vs. marketing).
- [ ] Revisión de costos del canal WhatsApp.
- [ ] Revisión de plantillas con la diseñadora (marca, legibilidad móvil, modo oscuro de clientes de correo).
- [ ] Prueba de carga del worker.

## Riesgos
- Entregabilidad de correo sin dominio/DNS bien configurado → configurar pronto el dominio (pendiente externo).
- Costo/aprobación de plantillas en API oficial de WhatsApp → opción manual como puente.

## Pendientes externos
Dominio y remitente, proveedor de email (D-03), decisión WhatsApp oficial vs. manual, textos de cada notificación (PENDIENTES_ADMIN §G).

## Estado real de entrega (2026-11-16)

**Hecho y verificado contra la nube.** Migración `20261116000100_s13_notificaciones.sql` aplicada; Edge Functions `notify-worker` y `notify-admin` desplegadas; panel `/admin/notificaciones` (registro, plantillas con vista previa y envío de prueba, envío y alertas) y `/cuenta/notificaciones` (preferencias y consentimiento). **Ningún correo real salió nunca**: falta que el dueño conecte Resend (cuenta, dominio verificado y secretos; ver `docs/notificaciones.md` y SPRINT_19 §R). Mientras tanto el proveedor está en «ninguno» y los avisos esperan en la cola sin perderse.

**Cifras:** pgTAP `20_s13_notificaciones` **308** aserciones (hermética: afirma propiedades, no el estado de los datos) y las 21 suites pgTAP pasan contra la nube (las `05` —listas blancas— y `06` —conteo de ajustes, 33 → 42— se ampliaron a propósito); Deno **264** pruebas (125 nuevas); unitarias **267 archivos / 5995 pruebas** (116 nuevas); tipos, ESLint y Prettier limpios; **integración contra la nube 19/19** con la función desplegada (éxito; transitorio con su espera de 60 y 120 s; permanente; 429 con su espera; `dead` con una sola alerta y reenvío; **tres workers a la vez sobre los mismos 12 avisos: se toman exactamente 12, sin duplicar**; un worker muerto cuyo aviso se rescata y entrega; correos que esperan sin proveedor; WhatsApp manual; un pedido real de punta a punta con «deshacer»; preferencias, plantillas, vista previa y envío de prueba con sus permisos); **E2E 20/20** (10 × escritorio y móvil, axe AA y sin desbordes). **Mutación:** SQL **27 mutantes** (un cambio deliberado por vez en la migración: retroceso, `dead`, descarte, canal, «deshacer», reenvío, consentimiento, anonimizar, permisos, límites…) corridos contra la prueba 20: **24 mueren en pgTAP**, cada uno en una aserción que habla de lo que se rompió; **M03** (quitar `SKIP LOCKED`) **sobrevive en pgTAP** (una sola sesión no disputa candados) y **mi primera prueba de integración tampoco lo detectaba**: tres workers a la vez no duplican igual, porque `FOR UPDATE` los hace esperar y al volver a evaluar la fila ya no está pendiente; lo que `SKIP LOCKED` cambia es que **un worker no se bloquee** esperando a otro. Se añadió una prueba que retiene el candado de un aviso mientras el worker procesa otro (con el mutante el worker espera y la base lo corta con un 500) y **con ella M03 muere**. **M06** (la comprobación de cuenta inactiva dentro del descarte) es **equivalente**: el `claim` vuelve a comprobar el contacto con `_notify_target`, que aplica las mismas condiciones. **M20** (quitar el `revoke` del worker sobre las plantillas) es **no concluyente en este arnés**: la nube ya tenía el `revoke` aplicado y reaplicar la migración sin él no devuelve el permiso; se verificó directamente que `service_role` no puede escribir plantillas ni preferencias y se añadieron 3 aserciones exactas de privilegios (pgTAP 305 → 308), pero **no se probó una instalación nueva sin esa línea**. Resultado: **25 de 27 detectados, 1 equivalente, 1 no concluyente**; funciones (Deno) **24/24** mueren; interfaz **20/20** mueren (en la primera pasada sobrevivían 2, **huecos reales** de mis pruebas: ningún caso probaba recortar espacios en un campo de texto —el navegador ya lo hace en los de correo— ni marcar únicamente las novedades por WhatsApp; ya tienen su prueba).

**Lo que NO se pudo verificar:** correos reales (entregabilidad, bandeja o spam, Gmail/Outlook/Apple Mail, mail-tester, Gmail Postmaster, rebotes); el adaptador de Resend contra una cuenta real (solo su contrato, verificado en su documentación, y cada clase de error con respuestas simuladas); el cron → worker de punta a punta (necesita los secretos del Vault; cada mitad se probó por separado); una caída de 1 hora con el proveedor real y la carga del worker; los correos de Auth con SMTP propio. No hubo revisión independiente por un agente sin contexto (la política del arnés pide que el usuario la pida).

**Regresión final (2026-11-16, en serie contra la nube; no todo salió verde a la primera):**
- **pgTAP, las 21 suites:** 20 en verde a la primera; la `17_s10_pedidos` falló **una aserción** en esa corrida (la cadena filtró su nombre y no quedó registrada) y **no se reprodujo**: repetida 7 veces (4 sola y 3 detrás de la 16) dio 368/368 siempre. Causa **no identificada**.
- **Integración (S13, pedidos, pagos, cupones):** 58/58 en verde. **Checkout: 18/19; falla «100 intentos simultáneos de 25 clientas sobre 10 unidades»** (en la cadena con `fetch failed`; sola, dos veces, con `statement timeout` de 8 s en `create_order`). **No es de S13:** con `_order_notify` reemplazada temporalmente por una función vacía (experimento A/B, migración real restaurada después y verificada) **falla igual**. El 2026-11-15, en S12, esa misma prueba ya había fallado en la corrida completa por red y pasó sola; ahora ni sola. Abierto: no se averiguó por qué (la base mide 63 MB y no hay filas muertas relevantes). Es la medida de cuánta concurrencia aguanta la nube de hoy, no una regresión demostrada.
- **E2E (7 archivos, 178 pruebas):** 160 en verde y 18 fallidas. Las trazas muestran peticiones a Supabase de 4–5 s o sin respuesta (login, vistas públicas, `cart`) en pantallas que S13 no toca. Repetidos los archivos con fallas: **119 de 126 en verde**, y las 3 pruebas de admin que aún fallaban pasaron 12/12 al repetirlas solas. **Una falla propia, corregida:** «empacado y deshacer» asertaba sobre toda la tabla y, mientras llegaba la búsqueda, la tabla mostraba filas de otros pedidos; ahora se acota por el número del pedido. **Una falla antigua, reproducida SIN S13:** «hay un enlace para saltar al contenido» (`admin.spec.ts:180`, escritorio y móvil) falla igual en `e3e2ba2` (S12): tras entrar, el primer Tab no cae en «Saltar al contenido». Queda abierta junto con los 2 fallos antiguos de `layout.spec`.
- Las pruebas de notificaciones pasaron todas (E2E y las 19 de integración) en la corrida final.

**Decisiones y desvíos del spec:**
- Los avisos de estado ya se encolaban desde S10: no se duplicaron. Se les dio **preferencia de canal** y **la espera del «deshacer»** (S12 lo exigía); un «deshacer» cancela el aviso y libera su clave.
- **Plantilla apagada = no se envía** (decisión de la tienda; sin alerta). **Plantilla inexistente o con error = texto de respaldo + alerta** (una por plantilla y día). El spec decía «desactivada → fallback + alerta»; se interpretó así para que apagar una plantilla signifique de verdad apagarla.
- **WhatsApp: solo modo manual** (enlace `wa.me` con el mensaje ya escrito y «Ya lo envié»); la API oficial no existe y su decisión y costo son del dueño.
- **Dominios reservados** (`.test`, `.example`…) jamás salen por un proveedor real: salvaguarda añadida porque la nube acumula miles de avisos de prueba. La migración canceló los 1956 pendientes anteriores a S13 (`before_s13`).
- El latido es de un minuto (cron); no hay disparo inmediato al encolar.
- **No hecho:** «Reutilizar patrones de Acrosoft» (sin acceso a ese código desde este repositorio), emails de Auth con SMTP propio (se configura en el panel de Supabase Auth), enlace de baja de marketing (no hay marketing todavía: solo el consentimiento, que nace apagado y queda fechado y auditado) y umbrales de «ruido» propios (se reutilizan los de stock y las alertas se deduplican).
- **De paso (hueco de S12):** los tres ajustes de S12 (`returns_enabled`, `return_window_days`, `order_undo_window_minutes`) no tenían pantalla en Configuración; ahora sí (sección Pedidos).

**Criterios de aceptación:**
1. *Exactamente una notificación por canal elegido:* **cumplido** (clave única por aviso, `dedupe_key`; probado en pgTAP y con encolado doble).
2. *Si el proveedor falla, el pedido no se afecta; se reintenta y, agotados los intentos, se alerta:* **cumplido** con el proveedor de pruebas (simulación de 127 min en SQL y la integración); **no verificado con el proveedor real**.
3. *Alertas de stock una vez por cruce de umbral:* **cumplido** (el disparador de S3 no cambió; ahora el worker las entrega).
4. *Los correos llegan a bandeja de entrada y se ven bien en Gmail/Outlook/Apple Mail móvil:* **no verificado** (no hay proveedor conectado).
5. *El admin puede reenviar manualmente cualquier notificación y ver su historial:* **cumplido** (registro con filtros, detalle con el mensaje enviado, hilo de reenvíos).

## Entregables para sprints siguientes
Infraestructura de notificaciones robusta y reutilizable (la usarán S14 para reportes programados, S17 para facturas y S18 para multi-idioma).
