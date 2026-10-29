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

## Entregables
Tienda v1.0 en producción, documentación completa, runbooks, monitoreo y alertas, informe de pruebas, backlog post-lanzamiento.
