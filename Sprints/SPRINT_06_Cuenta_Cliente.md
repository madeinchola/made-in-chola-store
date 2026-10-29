# Sprint 6 — Cuenta del cliente

**Release:** R2 · **Estimación:** 4 días · **Depende de:** S1 (auth backend), S4 (UI), S5 (layout storefront)

## Objetivo
Pantallas y datos de la cuenta del cliente: registro/login con identificador único, perfil, libreta de direcciones y datos fiscales, listos para ser usados en el carrito y el checkout.

## Alcance
**Dentro:** UI de login/registro/recuperación, perfil, direcciones (con ubicación en mapa), datos fiscales, desactivación de cuenta, sección "Mis pedidos" (estructura y vacío; se llena en S10).
**Fuera:** carrito (S7), cálculo de envío (S8), pedidos reales (S10).

## Reglas de negocio cubiertas
BR-ACC-01..08, BR-SHP-01 (captura de ubicación), S-02, S-08.

## Tareas

### BD
- [ ] `addresses` (profile_id, etiqueta, destinatario, teléfono, línea 1/2, ciudad, departamento, país, referencia, `lat`, `lng`, `is_default`, flags envío/facturación, `archived_at`).
- [ ] `tax_profiles` (profile_id, tipo de documento, número, razón social, `is_default`, `archived_at`).
- [ ] RLS: cada cliente solo ve/edita lo suyo; admin lectura (para atender pedidos); sin DELETE físico (BR-ACC-07).
- [ ] Constraint: **una sola dirección por defecto** por cliente (índice parcial único).
- [ ] Auditoría en cambios de perfil sensibles (email/teléfono).

### Frontend
- [ ] Pantalla **Entrar/Crear cuenta** con campo único "Email o teléfono", selector de país para teléfono, mostrar/ocultar contraseña, indicador de fortaleza, mensajes uniformes.
- [ ] **Recuperar contraseña** (flujo por email; alterno para solo-teléfono definido en S1).
- [ ] **Perfil:** nombre, email, teléfono (cambiar con reautenticación), contraseña, idioma/moneda preferida.
- [ ] **Direcciones:** listar, crear, editar, archivar, marcar predeterminada; **selector de ubicación en mapa** (Leaflet + OSM, S-08) con búsqueda por texto y pin arrastrable; permiso de geolocalización opcional y con explicación.
- [ ] **Datos fiscales:** CRUD simple, uno por defecto, validación de formato NIT/CI (Bolivia) con tolerancia configurable.
- [ ] **Mis pedidos** (shell): lista vacía + estructura de detalle para S10.
- [ ] **Desactivar cuenta:** flujo con confirmación, explica qué se conserva (pedidos) y qué se anonimiza.
- [ ] Integración con carrito invitado: al iniciar sesión se dispara `merge_guest_cart` (se implementa en S7; aquí se deja el *hook* y el contrato).
- [ ] CSP actualizada para tiles de mapa y geocodificación.

## Criterios de aceptación
1. Registro, login y recuperación funcionan con email y con teléfono.
2. El cliente administra varias direcciones y datos fiscales; solo una por defecto.
3. La ubicación (lat/lng) queda guardada y es utilizable por S8.
4. Desactivar cuenta cierra sesión y conserva los pedidos asociados.
5. Un cliente nunca ve datos de otro (probado a nivel SQL y E2E).

## Testing
- **Unit:** validadores de NIT/CI, teléfono, contraseña; helper de dirección por defecto.
- **SQL/RLS:** matriz de roles sobre `addresses` y `tax_profiles`; unicidad de dirección por defecto bajo concurrencia.
- **Componentes:** formulario de dirección (campos obligatorios por país), mapa (mock de tiles), estados de error.
- **E2E:** crear cuenta → agregar dirección con pin → editar → archivar → marcar default; recuperar contraseña; cambiar teléfono; desactivar cuenta.
- **Accesibilidad:** formularios largos con teclado; mapa con alternativa textual.
- **Seguridad:** intento de leer/editar direcciones ajenas por ID (IDOR); XSS en campos de texto.

## Edge cases
- Mismo teléfono en distintos formatos; email con mayúsculas; intento de usar un identificador ya registrado.
- Cambiar el teléfono/email a uno existente; cambio de identificador principal en usuario solo-teléfono.
- Marcar como default la dirección que se archiva; archivar la única dirección.
- Geolocalización denegada o impreciso; pin fuera de zona de cobertura (S8); dirección sin lat/lng guardada de antes.
- Mapa sin conexión / tiles bloqueados / geocodificador caído → permitir ingreso manual de coordenadas o referencia textual.
- Direcciones muy largas, caracteres especiales, emoji.
- NIT inválido/duplicado entre clientes (permitido) pero formato correcto.
- Sesión expira mientras se edita un formulario → no perder datos.
- Cuenta desactivada intenta re-registrarse con el mismo identificador (política de reactivación).
- Doble envío del formulario, múltiples pestañas, cambios simultáneos desde dos dispositivos.
- Menores de edad / datos de terceros: solo política de privacidad (S15).

## Revisión
- [ ] Checklist universal.
- [ ] Revisión de privacidad: mínimo de PII, anonimización al desactivar.
- [ ] Revisión de límites de tasa en recuperación de contraseña (abuso de envío de emails).
- [ ] Revisión UX móvil de formularios (teclado numérico para teléfono, autocompletado correcto).
- [ ] Validar licencia/uso de OSM y política de tiles/geocodificación (rate limits, atribución).

## Riesgos
- Dependencia de servicios gratuitos de mapas/geocodificación (límites) → capa de abstracción para cambiar a Google/Mapbox (D-04).
- Calidad de direcciones en Bolivia (sin estandarización) → priorizar el pin + referencia textual.

## Pendientes externos
Reglas de verificación de NIT/CI; decisión D-03 para recuperación de contraseña de solo-teléfono; textos legales de consentimiento (S15).

## Entregables para sprints siguientes
Cuenta completa, `addresses` con lat/lng, `tax_profiles`, contrato `merge_guest_cart`, componente de mapa/selector de ubicación (S8, S10).
