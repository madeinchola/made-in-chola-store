# Índice de Sprints y Matriz de Dependencias

> Referencia: [../DOCUMENTO_MAESTRO.md](../DOCUMENTO_MAESTRO.md) (reglas `BR-*`, supuestos `S-*`, decisiones `D-*`)
> Pendientes externos: [../PENDIENTES_ADMIN.md](../PENDIENTES_ADMIN.md)

## Regla de oro
**Un sprint solo consume lo que ya entregó un sprint anterior.** Si algo debe existir antes, se adelanta como *punto de extensión* con implementación por defecto (ej.: el motor de precios nace en S10 con "envío = 0 / sin cupón" solo si S8/S9 no estuvieran, pero aquí S8 y S9 van antes, por eso no hay huecos).

## Orden de ejecución

| # | Sprint | Release | Depende de | Estimación* |
|---|---|---|---|---|
| 0 | [Fundaciones y entorno](SPRINT_00_Fundaciones.md) | R1 | — | 2 d |
| 1 | [Auth, roles y seguridad base](SPRINT_01_Auth_Roles_Seguridad.md) | R1 | 0 | 3 d |
| 2 | [Modelo de catálogo, monedas e inventario](SPRINT_02_Catalogo_Monedas_Inventario.md) | R1 | 0, 1 | 3 d |
| 3 | [Admin: shell + CRUD de catálogo](SPRINT_03_Admin_CRUD_Catalogo.md) | R1 | 1, 2 | 5 d |
| 4 | [Sistema de UI / Design System](SPRINT_04_Sistema_UI.md) | R1 | 0 (+ diseño entregado) | 4 d |
| 5 | [Storefront: home, listado, detalle, SEO](SPRINT_05_Storefront_Catalogo.md) | R1 | 2, 3, 4 | 5 d |
| 6 | [Cuenta del cliente](SPRINT_06_Cuenta_Cliente.md) | R2 | 1, 4, 5 | 4 d |
| 7 | [Carrito y retención de stock](SPRINT_07_Carrito.md) | R2 | 2, 5, 6 | 4 d |
| 8 | [Envíos y entregas programadas](SPRINT_08_Envios.md) | R2 | 3, 6, 7 | 4 d |
| 9 | [Descuentos y cupones](SPRINT_09_Descuentos_Cupones.md) | R2 | 3, 7 | 4 d |
| 10 | [Pedidos y checkout (WhatsApp / contra entrega)](SPRINT_10_Pedidos_Checkout.md) | R2 | 6, 7, 8, 9 | 6 d |
| 11 | [Pagos: QR boliviano y capa de proveedores](SPRINT_11_Pagos.md) | R3 | 10 | 5 d |
| 12 | [Admin de pedidos y operación](SPRINT_12_Admin_Pedidos_Operacion.md) | R3 | 10, 11 | 6 d |
| 13 | [Notificaciones y alertas](SPRINT_13_Notificaciones.md) | R3 | 10, 12 (3 para alertas) | 4 d |
| 14 | [Dashboard, reportes y carga masiva](SPRINT_14_Dashboard_Reportes_Masiva.md) | R3 | 3, 12 | 5 d |
| 15 | [Legal, SEO avanzado y analytics](SPRINT_15_Legal_SEO_Analytics.md) | R3 | 5, 10 | 4 d |
| 16 | [Hardening y lanzamiento v1.0](SPRINT_16_Hardening_Lanzamiento.md) | R4 | 0–15 | 5 d |
| 17 | [Facturación electrónica (condicional)](SPRINT_17_Facturacion_Electronica.md) | R5 | 12, 16 + respuesta admin | 5 d |
| 18 | [Multi-país y pasarelas internacionales](SPRINT_18_MultiPais_Pasarelas.md) | R5 | 11, 16 | 8 d |
| 19 | [Acciones manuales del dueño (transversal)](SPRINT_19_Acciones_Manuales.md) | todas | — (en paralelo; bloquea S5, S6, S7 y S16 según la tarea) | acciones del dueño |

\* Días de desarrollo asistido por persona, orientativos; se reestiman al cerrar cada sprint.

## Grafo de dependencias

```
S0 ─┬─ S1 ─┬─ S2 ─┬─ S3 ──────────────┬─ S8 ──┐
    │      │      │                    │       │
    │      │      └────────┐           ├─ S9 ──┤
    └─ S4 ─┴───────────────┴─ S5 ─ S6 ─┴─ S7 ──┴─ S10 ─ S11 ─ S12 ─┬─ S13
                                                                   ├─ S14
                                                       S5 + S10 ───┴─ S15
                                                       S0–S15 ────── S16 ─┬─ S17
                                                                          └─ S18
```

## Verificación de dependencias (qué consume cada sprint)

| Sprint | Consume (entregado antes) |
|---|---|
| S1 | Repo, Supabase local, CI, tests (S0) |
| S2 | Auth/roles/RLS helpers `is_admin()` (S1), migraciones y tests SQL (S0) |
| S3 | Tablas de catálogo + storage + RPC de stock (S2), rutas protegidas admin (S1) |
| S4 | Tailwind/shadcn/tokens base (S0); diseño de la diseñadora (externo) |
| S5 | Datos y vistas públicas (S2), productos cargados desde admin (S3), componentes UI (S4) |
| S6 | Auth backend (S1), UI base (S4), layout storefront (S5) |
| S7 | Variantes/stock/reservas (S2), tarjetas y detalle (S5), sesión/cuenta para fusionar carrito (S6) |
| S8 | Ajustes y mapas/ubicaciones admin (S3), direcciones del cliente (S6), carrito con totales (S7) |
| S9 | Panel admin (S3), carrito y líneas (S7) |
| S10 | Cuenta/direcciones/datos fiscales (S6), carrito (S7), `quote_shipping` (S8), `apply_discount` (S9) |
| S11 | Pedidos, `payments` base y estados (S10) |
| S12 | Pedidos y pagos (S10, S11) |
| S13 | Outbox escrito por S3 (alertas), S10 y S12 (estados) |
| S14 | Datos de pedidos/costos (S10, S12), CRUD catálogo para importación (S3) |
| S15 | Tienda y checkout existentes (S5, S10) |
| S16 | Todo el sistema |
| S17 | Pedidos/pagos/reembolsos (S12), sistema estable (S16) |
| S18 | Capa de pagos (S11), moneda/país (S2), sistema estable (S16) |

## Cortes de release y go/no-go

- **R1 (tras S5):** admin crea/edita/archiva productos; tienda pública navegable, rápida y responsive; SEO base; **sin compra aún**. Go/No-go: demo + checklist de S5.
- **R2 (tras S10):** compra completa por WhatsApp/contra entrega con stock atómico.
- **R3 (tras S15):** operación diaria cómoda (pagos, estados, notificaciones, reportes, legales).
- **R4 (S16):** lanzamiento público v1.0.
- **R5:** expansión (facturación, países, pasarelas).

> Nota de producto: si el dueño necesita **vender ya** en el MVP, la vía de menor costo es un botón "Consultar por WhatsApp" por producto en S5 (enlace `wa.me` con nombre/variante, sin cuentas ni pedidos). No altera ninguna dependencia posterior.

## Plantilla común de cada sprint
Objetivo · Release/Estimación · Dependencias · Alcance (dentro/fuera) · Reglas de negocio · Tareas (BD / Backend / Frontend / UI) · Criterios de aceptación · **Testing** · **Edge cases** · **Revisión** · Riesgos · Pendientes externos · Entregables para sprints siguientes.

## Checklist de revisión universal (se repite en cada sprint)
- [ ] `lint`, `tsc --noEmit`, `build` y todos los tests verdes en CI
- [ ] `supabase db reset` desde cero funciona; migraciones idempotentes
- [ ] RLS: tests por rol (anon, customer, otro customer, admin) para cada tabla/RPC nueva
- [ ] Sin secretos en repo ni en bundle del front; `.env.example` actualizado
- [ ] Estados vacío/carga/error en cada pantalla nueva
- [ ] Responsive (360 px, 768 px, 1280 px) y teclado/lectores de pantalla en lo nuevo
- [ ] Sin `console.error` ni warnings de React en flujos probados
- [ ] Textos en archivos i18n (no quemados)
- [ ] Logs sin datos personales; errores con correlación
- [ ] Documento del sprint actualizado con lo realmente entregado y deudas técnicas
