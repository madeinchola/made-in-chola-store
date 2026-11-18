# Sprint 16 — Hardening y lanzamiento v1.0

**Release:** R4 · **Estimación:** 5 días · **Depende de:** S0–S15 completos

## Objetivo
Convertir un sistema funcional en uno **confiable en producción**: auditoría de seguridad, pruebas de carga y caos, observabilidad, backups, runbooks y un lanzamiento controlado con plan de contingencia.

## Alcance
**Dentro:** auditoría de seguridad/RLS, pruebas de carga/concurrencia, E2E completo, accesibilidad final, monitoreo y alertas, backups/restauración, configuración de producción, datos reales, ensayo de lanzamiento, runbooks, capacitación a admins.
**Fuera:** nuevas funcionalidades (congelamiento de alcance), facturación (S17), multi-país (S18).

## Reglas de negocio cubiertas
Todas (verificación transversal), con foco en BR-DAT-02, BR-DAT-03, BR-INV-04 y §8 del maestro.

## Tareas

### Seguridad
- [ ] Auditoría completa de **RLS** tabla por tabla, buckets y funciones `SECURITY DEFINER` (tests automáticos por rol + revisión manual).
- [ ] Revisión OWASP Top 10: inyección, XSS (descripciones, nombres, notas), CSRF, IDOR (pedidos, direcciones, comprobantes), SSRF (URLs de import), subida de archivos, fuga de datos en errores.
- [ ] Rate limits efectivos en login, registro, reserva de stock, cupones, `create_order`, reclamos.
- [ ] Revisión de CSP/headers en producción (con herramientas externas), cookies seguras, CORS estricto.
- [ ] Rotación de secretos, ninguna clave de servicio en el bundle (escaneo de secretos en repo e historial).
- [ ] Dependencias: `npm audit`, actualización de vulnerabilidades, bloqueo de versiones.
- [ ] Prueba de intrusión básica (checklist propio o externa si el presupuesto lo permite).
- [ ] Revisión de la política de contraseñas, bloqueos y recuperación de cuenta.

### Fiabilidad y rendimiento
- [ ] **Pruebas de carga** (k6/Artillery) de catálogo, carrito, checkout y `create_order` con ráfaga tipo campaña; objetivo definido (p. ej. 50 pedidos/min con p95 < 2 s) y ajustado a volumen real cuando exista.
- [ ] **Concurrencia de stock** a gran escala: miles de intentos sobre pocas unidades; invariantes verificadas.
- [ ] Pruebas de **caos**: caída del proveedor de pagos/email/WhatsApp, webhooks duplicados/perdidos, Supabase lento; degradación elegante.
- [ ] Optimización de consultas lentas, índices, tamaño de bundle, caché y CDN de imágenes.
- [ ] Límites y cuotas de Supabase/Vercel revisados (conexiones, Storage, Edge Functions, ancho de banda); plan de capacidad.

### Operación
- [ ] **Observabilidad:** logs estructurados con correlación, captura de errores (Sentry o equivalente) en front y Edge Functions, métricas de negocio técnicas (pedidos fallidos, pagos pendientes, outbox atascado), *uptime monitoring*.
- [ ] **Alertas** accionables (pedidos creados con error, webhooks fallando, cola de notificaciones creciendo, stock negativo = imposible, jobs cron sin ejecutar).
- [ ] **Backups** (PITR si el plan lo permite) y **restauración probada** en un entorno limpio; plan de recuperación (RPO/RTO acordados).
- [ ] Entornos: staging idéntico a producción; variables y secretos verificados; migraciones aplicadas con proceso de despliegue documentado y *rollback*.
- [ ] Dominio propio, DNS, HTTPS, redirecciones `www`, correo (SPF/DKIM/DMARC) verificados.
- [ ] **Runbooks:** pago atascado, webhook caído, stock inconsistente, pedido duplicado, restauración, cambio de proveedor, bloqueo de cuenta, "cómo cancelo todo en una emergencia".
- [ ] Documentación final: README, arquitectura, diccionario de datos, guía de despliegue, guía del admin (con capturas) y videos cortos.

### Calidad
- [ ] Suite **E2E completa** (visitante → compra → admin procesa → entrega → reporte) en móvil y escritorio, Chrome/Safari/Firefox.
- [ ] Accesibilidad final (WCAG AA) con auditoría manual y automática.
- [ ] Prueba de **usabilidad** con 5 personas reales (compra en móvil) y con los 2 admins.
- [ ] Revisión visual con la diseñadora (fidelidad final).
- [ ] Revisión de contenido: datos reales cargados, textos, imágenes, links rotos, errores ortográficos.
- [ ] Verificación de analytics en producción con IDs reales.

### Lanzamiento
- [ ] **Checklist go/no-go** firmado (ver abajo).
- [ ] **Ensayo general** en staging con datos copiados/anonimizados.
- [ ] **Soft launch:** acceso limitado (amigos/lista corta), pedido real de bajo monto de punta a punta (pago, WhatsApp, entrega, reembolso).
- [ ] Plan de **contingencia y rollback**; ventana de lanzamiento elegida (evitar picos); responsables y canales de comunicación.
- [ ] Monitoreo reforzado las primeras 72 h; revisión diaria de pedidos, errores y feedback.
- [ ] Retrospectiva y backlog priorizado post-lanzamiento.

## Checklist Go / No-Go (bloqueantes)
- [ ] Cero hallazgos críticos/altos abiertos de seguridad.
- [ ] Concurrencia de stock sin violaciones de invariantes en pruebas de carga.
- [ ] Pago, expiración, cancelación y reembolso verificados con dinero real de bajo monto.
- [ ] Backup restaurado con éxito en las últimas 7 días.
- [ ] Textos legales aprobados y publicados; consentimiento de cookies funcionando.
- [ ] Alertas activas y probadas (se disparan y llegan a las personas correctas).
- [ ] Los 2 admins capacitados y con runbooks a mano.
- [ ] DNS, HTTPS, correo (SPF/DKIM/DMARC) y dominio verificados.
- [ ] Plan de rollback ensayado.

## Criterios de aceptación
1. Todos los bloqueantes del checklist cumplidos.
2. Suite E2E y de carga ejecutadas en CI/staging con resultados documentados.
3. Un pedido real de punta a punta completado y reembolsado en producción.
4. Los admins operan sin asistencia durante el soft launch.

## Testing
- **Seguridad:** matriz de roles automatizada; escaneo SAST/DAST; fuzzing de RPC y endpoints; pruebas de IDOR/escalada.
- **Carga y resistencia:** ráfaga de checkout, soak test de 1–2 h, picos repentinos, límites de conexiones.
- **Caos/resiliencia:** proveedores caídos, red lenta, reinicios de funciones, jobs cron retrasados.
- **Recuperación:** simulacro de restauración y de rollback de migración.
- **E2E regresión total + accesibilidad + cross-browser/dispositivo** (iOS Safari, Android Chrome).
- **Humo de producción:** script post-despliegue (home, producto, carrito, checkout de prueba, admin, webhooks).

## Edge cases
- Pico de tráfico simultáneo con pedidos en el mismo producto popular (lanzamiento de colección).
- Migración de datos reales (importación de catálogo) con SKU duplicados o datos sucios.
- Zona horaria/cambio de fecha durante el lanzamiento; relojes desfasados.
- Caída del proveedor de pagos justo al lanzar → modo "solo WhatsApp/contra entrega" activable sin despliegue (feature flag).
- Admin pierde acceso (olvida contraseña) con el único otro admin ausente → procedimiento de recuperación.
- Cuenta de Supabase/Vercel en límite de plan; cuota de emails agotada.
- Errores humanos al cargar precios/stock el día del lanzamiento → reversión de import, auditoría.
- Cliente real usa la tienda con navegador viejo/conexión 3G.
- Campaña publicitaria dirige tráfico antes de lo previsto.
- Datos de prueba que quedan en producción (cuentas, pedidos, cupones) → limpieza/archivado verificado.

## Revisión
- [ ] Checklist universal.
- [ ] Revisión final de arquitectura y deuda técnica registrada.
- [ ] Revisión de costos mensuales proyectados (Supabase, Vercel, correo, WhatsApp, mapas).
- [ ] Verificación de cumplimiento legal y de privacidad.
- [ ] Acta de aceptación con el dueño.

## Riesgos
- Presión por lanzar con deuda de seguridad → los bloqueantes no son negociables.
- Falta de datos reales de volumen → pruebas con escenarios conservadores y agresivos; ajustar planes de infraestructura.

## Pendientes externos
Cuentas definitivas (Supabase/Vercel/dominio), datos reales de catálogo, credenciales de pagos en producción, aprobación legal, fecha de lanzamiento.

## Estado real de entrega (2026-11-18)

**Alcance acordado con el dueño: «solo lo seguro, sin carga».** Se hizo la auditoría de seguridad, las herramientas, los contratos de seguridad ejecutables, los runbooks y la documentación operativa. **No se hicieron** pruebas de carga, de concurrencia masiva ni de caos contra la nube (podían agotar conexiones y cuotas del único proyecto), ni lo que exige personas, cuentas o dominio del dueño (usabilidad, restauración de copias, dominio, soft launch, capacitación). **Este sprint NO queda listo para lanzar**: la auditoría dejó **dos hallazgos altos y un bloqueante abiertos** y descubrió que **el proyecto no tiene copias de seguridad**; todo está en `docs/seguridad.md` y en SPRINT_19 §U.

**Hecho y verificado contra la nube**
- **Auditoría de seguridad** (`docs/seguridad.md`): 69 tablas, 128 políticas, 251 funciones (97 ejecutables desde el navegador, 14 por un visitante), 24 vistas, 5 buckets, 16 funciones de Edge, cabeceras, CORS, XSS, IDOR, SSRF, subidas, dependencias, secretos (archivos e historial) y la configuración real de Auth. **Ningún hallazgo crítico.**
- **Corregido**: tres columnas internas legibles por la propia clienta (`profiles.blacklisted`, `orders.request_hash`, `payments.collected_by`); `profiles`, `orders` y `payments` pasaron de SELECT por tabla a **SELECT por columnas** (una columna nueva nace privada; migración `20261118000500_s16_endurecimiento.sql`); `parseBody` con **tope de 16 KiB** (`login`, `register`, `change-password`, `set-password`, `deactivate-account`, `update-contact`); el historial de `pg_cron` (≈ 150 MB al año) se purga a los 14 días.
- **Contratos ejecutables**: pgTAP `27_s16_auditoria_seguridad` (**34** aserciones: ninguna política `true`/`anon`/`public`, funciones que se autorizan por dentro, vistas, Storage, **las columnas exactas que lee la clienta**, esquemas internos); `scripts/edge-security.test.mjs` (**58**: cómo se autentica y protege cada función de Edge); `src/db/security-matrix.integration.test.ts` (**19** casos por HTTP real con un visitante, dos clientas y funciones de administración, con las listas sacadas del catálogo).
- **Salud del sistema**: migración `20261118000600_s16_salud_sistema.sql` con `public.system_health()` (solo `service_role`, 18 comprobaciones: 10 trabajos de cron, que el cron **pueda llamar** al worker de avisos, avisos atrasados y perdidos, cobros y reservas atascados, stock que no cuadra con el libro, avisos de pago rechazados y tamaño) y el trabajo `purge-cron-history`; pgTAP `28_s16_salud_sistema` (**88** aserciones a ambos lados de cada umbral y del estado general); `npm run health`.
- **Herramientas** (todas de solo lectura salvo `backup`, que solo lee la base): `npm run security:secrets` y `security:secrets:history` (en el CI), `security:auth-config`, `smoke`, `health`, `backup` y `docs:data-dictionary`.
- **Documentación**: `docs/seguridad.md`, `docs/runbooks.md` (13 runbooks, cada paso marcado «ensayado» o «no ensayado»), `docs/despliegue.md` y `docs/diccionario-datos.md` (generado del catálogo).
- **Funciones de Edge**: las 16 redesplegadas el 2026-11-18 (alinea la nube con el repositorio, incluido el formato de S15, y aplica el tope de cuerpo).
- **Registro de migraciones**: las 13 migraciones de S10 a S16 se habían aplicado a mano sin registrarse en `supabase_migrations.schema_migrations`: `supabase db push` habría intentado repetirlas. **Registradas el 2026-11-18**; el procedimiento nuevo está en `docs/despliegue.md`.

**Cifras**
- **pgTAP:** 29 suites en verde contra la nube (incluye `05`, la `27` con 34 aserciones y la `28` con 88). **Deno:** 311. **Unitarias:** 6 598 en 311 archivos; lint, formato y tipos limpios. **Secretos:** 0 reales en 1 260 archivos y en todo el historial.
- **Mutación (se cambia una cosa y la prueba tiene que fallar):** suite `27` 45 de 45 detectados; matriz HTTP 8 de 9 (el noveno lo frena una segunda defensa de Postgres: para actualizar o borrar una fila también hay que poder verla); contrato de las funciones de Edge 17 de 17; `system_health()` 47 mutantes, 45 detectados y 2 equivalentes (cambian el código pero no el comportamiento observable). Las herramientas de `scripts/` también se probaron con mutantes.
- **Integración completa contra la nube** (519 pruebas, sin pgTAP): 477 pasaron, 6 se omiten y 36 fallaron. Por causa:
  - **2 eran de S16 y están arregladas.** Dos `PATCH` a `profiles` sin `select=` devolvían `RETURNING *` y chocaban con la columna interna ahora cerrada. La app no se afecta (ya pide columnas concretas). Pasan.
  - **4 fueron transitorias** (520 de Cloudflare, `statement timeout` bajo carga): reactivación de cuenta, JWT falso del carrito, tramo de 7 km del envío y checkout de 12 clientas. Las cuatro pasan al repetirlas solas.
  - **2 siguen abiertas desde antes de S16:** `update-contact` con dos cambios simultáneos (estado 546 de la plataforma) y el checkout de 100 intentos simultáneos.
  - **28 por el tamaño de los datos acumulados en la nube** (1 296 productos activos de corridas anteriores; las pruebas suponen hasta 1 000 o 100 por página): 24 de la tienda, 3 del catálogo y 1 de la auditoría. El mecanismo se ve en el mapa del sitio (1 224 contra 1 000), pero **no repetí cada una tras limpiar la nube**: la atribución del resto es por el mismo mecanismo, no demostrada una por una.
- **E2E sobre la compilación de producción** (account, account-addresses, admin, admin-orders, admin-payments, checkout, payments, cart, auth, storefront y cookies): primera corrida 269 pasaron y 36 fallaron (25 con el mismo síntoma: tras iniciar sesión, el menú de cuenta no aparece en 5 s); la nube respondía lenta (registro 8 s, login 3 s por HTTP directo). Con esperas de 20 s los 6 archivos afectados dieron 267 pasadas y 8 fallos: 2 del test del bundle (necesita su propia URL base), 4 de cart por cortes de red de Node (`ConnectTimeoutError`, `ECONNRESET`) y 2 de accesibilidad del panel. **Repetidos en aislamiento pasan los 36** (34 de cart/panel + los 2 del bundle). No quedó ningún fallo reproducible, pero **sí queda sensibilidad a la latencia de la nube**; no puedo descartar que el límite de 30 inicios de sesión por IP cada 15 min también influyera. `layout.spec` no se corrió esta vez.
- **Humo** contra `made-in-chola-store.vercel.app`: 25–26 de 26. **Copia de seguridad:** 5,9 MB, 1 449 objetos, 106 tablas con datos, verificada con `pg_restore --list` (**restauración no ensayada**). **`npm audit`:** 24 avisos pasaron a 23 (el resto exige versiones mayores).

**Lo que la verificación atrapó (arreglado)**
- Mi propia función de salud contaba mal el atraso de los avisos pendientes (miraba `next_retry_at` con el valor por omisión «ahora» y no `created_at`): el caso «un pendiente de hace 4 horas» la delató y se unificó la regla en el turno de envío (`next_retry_at`).
- El stock «negativo» que iba a vigilar es **imposible por restricción** de la base (`stock_on_hand >= 0`): se cambió por lo que sí puede fallar, que el stock cuadre con el libro de movimientos y no haya más reservado que existente (0 desajustes hoy sobre 2 855 variantes y 5 261 movimientos).
- `scripts/smoke.mjs` tomaba como tienda el valor de `--supabase https://…`; `scripts/backup.mjs` contaba cada tabla dos veces (también su fila de datos); un dato de mi prueba se marcaba como perdido «reciente» sin serlo. Todos con su prueba.
- **Cerrar columnas tiene un costo escondido:** con `SELECT` por columnas, un `PATCH` (o `.update().select()`) a `profiles`, `orders` o `payments` sin lista de columnas pide `RETURNING *` y recibe 403. Dos pruebas de integración lo delataron; la app no, porque siempre pide columnas. Quien escriba código nuevo contra esas tablas debe listar las columnas (queda en `docs/seguridad.md`).
- `npm audit fix` solo pudo subir `typescript-eslint` y `lint-staged`; el resto (vite, vitest, tailwind, zod) exige versiones mayores y queda documentado como riesgo aceptado con plan.
- El escáner de secretos marcó 3 valores de ejemplo falsos de pruebas anteriores (una URL de Postgres inventada y un JWT de 64 caracteres): se anotan con su motivo en `scripts/secret-scan.allow.json` y con `secret-scan: allow`. **Ninguna clave real** en el árbol ni en el historial.

**Lo que NO se hizo ni se pudo verificar**
- **Pruebas de carga, de concurrencia a gran escala, de caos y de recuperación**: excluidas a pedido del dueño. La prueba «100 intentos simultáneos sobre 10 unidades» (que falla en la nube con `fetch failed` desde S13) **sigue abierta**.
- **Restauración de una copia**: no hay copias que restaurar (el proyecto no las tiene). `npm run backup` crea y verifica una copia (`pg_restore --list`), pero **no se ensayó restaurarla** (hace falta un proyecto vacío).
- **Entorno de ensayo (staging)**: no existe; hay un solo proyecto.
- **Observabilidad externa**: no hay monitor de disponibilidad ni captura de errores (Sentry): son cuentas del dueño. Lo interno (`system_health()` y las alertas de S13) sí.
- **Safari y Firefox**, **usabilidad con personas reales**, **revisión visual con la diseñadora**, **lectores de pantalla**, **Lighthouse y Web Vitals** con el dominio real, **verificación de analítica con IDs reales**, **dominio, DNS y correo (SPF/DKIM/DMARC)**, **soft launch con un pedido real** y **capacitación de las administradoras**: dependen de personas o cuentas del dueño (SPRINT_19 §U).
- **MFA, captcha y reautenticación de contraseña**: descritos, no implementados ni probados (H-01, H-02): son decisiones del dueño.
- **Prueba de intrusión externa** y escaneo DAST con una herramienta.

**Decisiones y desvíos del spec**
- **«Congelamiento de alcance»**: no se añadió ninguna función visible para clientas. Lo nuevo es de operación (salud, copias, humo) y de seguridad (columnas, tope de cuerpo).
- **Las pruebas de seguridad se escribieron como contratos que leen el catálogo**, no como listas de casos: una tabla, función, vista, bucket o columna nueva entra sola y obliga a decidir.
- **`system_health()` es solo del servicio** (no del navegador): un panel de salud para las administradoras sería una pantalla nueva y se deja como decisión.
- **Las copias manuales (`npm run backup`) no sustituyen a las del plan**: se dejó escrito así en el propio script y en los runbooks.

**Checklist Go / No-Go (a hoy)**
| Bloqueante | Estado |
| --- | --- |
| Cero hallazgos críticos/altos abiertos de seguridad | **NO**: H-01 y H-02 abiertos (decisión del dueño); H-03 bloqueante |
| Concurrencia de stock sin violaciones en pruebas de carga | **No verificado** (excluido); la prueba de 100 simultáneas sigue abierta |
| Pago, expiración, cancelación y reembolso con dinero real de bajo monto | **No hecho** (soft launch) |
| Backup restaurado con éxito en los últimos 7 días | **NO**: el proyecto no tiene copias |
| Textos legales aprobados y publicados; consentimiento de cookies | Cookies funcionando (S15); **textos sin aprobar** |
| Alertas activas y probadas | Alertas internas y `system_health()` probadas con fixtures; **no hay monitor externo ni worker de avisos configurado** |
| Los 2 admins capacitados y con runbooks a mano | **No**: runbooks escritos; falta la persona y la capacitación |
| DNS, HTTPS, correo (SPF/DKIM/DMARC) y dominio verificados | **No**: sin dominio propio |
| Plan de rollback ensayado | **Parcial**: escrito (`docs/despliegue.md`); no ensayado contra un entorno de ensayo |

**Criterios de aceptación**
1. *Todos los bloqueantes del checklist cumplidos:* **no** (ver la tabla).
2. *Suite E2E y de carga ejecutadas con resultados documentados:* E2E sí (ver cifras); **carga excluida**.
3. *Un pedido real de punta a punta completado y reembolsado en producción:* **no hecho**.
4. *Los admins operan sin asistencia durante el soft launch:* **no hecho**.

## Entregables
Tienda v1.0 en producción, documentación completa, runbooks, monitoreo y alertas, informe de pruebas, backlog post-lanzamiento.
