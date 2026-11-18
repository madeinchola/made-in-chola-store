# Despliegue, entornos y vuelta atrás (Sprint 16)

Cómo se sube cada cosa, en qué orden, con qué se comprueba y cómo se deshace. Lo que sigue describe lo que **se hace hoy**, no un ideal.

## Dónde corre cada cosa

| Pieza | Dónde | Cómo se actualiza |
| --- | --- | --- |
| Tienda y panel (React) y las funciones de `api/` (robots, mapa del sitio, feeds, SEO) | **Vercel** (`made-in-chola-store.vercel.app`) | `git push` a `main`: Vercel compila y publica solo |
| Base de datos, Auth, Storage, cron | **Supabase** (un solo proyecto, el de la nube) | migraciones aplicadas a mano (abajo) |
| Funciones de Edge (16) | Supabase | `functions deploy` (abajo) |
| Secretos | Vercel (`VITE_*`, públicos), Supabase (secretos de las funciones) y el **vault** de Supabase | a mano, desde el panel |

> **No hay un entorno de ensayo (staging).** Hay **un solo** proyecto de Supabase que hace de desarrollo, de pruebas y, desde el lanzamiento, de producción: «staging idéntico a producción» (S16) **no se cumple**. Antes de lanzar hay que decidir: o este proyecto pasa a ser producción tras el vaciado de entrega (`db reset --linked --no-seed`) y se crea otro para ensayar, o se crea uno nuevo para producción y este queda de ensayo. Ver SPRINT_19.

## Variables y secretos

**Vercel** (públicas; viajan al navegador, nunca una clave de servicio): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (la clave publicable), `VITE_APP_ENV` (`production`), `VITE_SITE_URL` (la dirección pública). La aplicación las valida al arrancar y **rechaza** una clave de servicio.

**Secretos de las funciones de Edge** (`npx supabase secrets set NOMBRE=valor`; `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta Supabase):

| Secreto | Para qué | Si falta |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | los orígenes que pueden llamar a las funciones desde el navegador (dominio de la tienda; sin `*`) | **solo funcionan los orígenes de desarrollo**: la tienda publicada no podría comprar |
| `SITE_URL` | dirección de los enlaces de los correos | los enlaces usan la de Vercel |
| `RESEND_API_KEY` | enviar correos de pedidos | los avisos esperan en la cola |
| `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE`, `META_GRAPH_VERSION` | API de conversiones de Meta | inerte (no hace nada) |
| `PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>` | firma de los avisos de un proveedor de pago | nada se acepta (503) |

**Vault** (Supabase → Vault): `notify_worker_url` y `notify_worker_key`. Sin ellos el cron **no llama** al worker de avisos y los correos no salen, aunque el cron figure «bien» (hoy es el caso; `npm run health` lo muestra como `notify.worker`).

**Auth** (panel de Supabase → Authentication, no se versiona): `npm run security:auth-config` compara con la línea base; `-- --launch` exige además el dominio propio y quitar `localhost`.

## Orden de una subida

1. **En tu máquina:** `npm run verify` (lint, formato, tipos, pruebas, pruebas de las funciones de Deno) y `npm run security:secrets`.
2. **Migraciones** (si las hay), una por una:
   1. **Ensayo** dentro de una transacción que se revierte: `begin; \i supabase/migrations/<archivo>.sql; <comprobaciones>; rollback;` por el pooler (`docs`/memoria «Acceso SQL a la nube»; el host directo de la base es solo IPv6).
   2. **Aplicar de verdad:** `begin; set client_min_messages = warning; \i <archivo>; commit;`.
   3. **Registrarla** para que `npx supabase db push` sepa que ya está: `insert into supabase_migrations.schema_migrations (version, name) values ('<AAAAMMDDHHMMSS>', '<nombre>');`. *Entre S10 y S16 esto no se hizo y se corrigió el 2026-11-18 (13 migraciones registradas): sin el registro, `db push` habría intentado aplicarlas otra vez.*
   4. **Pruebas contra la nube:** `npm run test:integration -- src/db` (corre todos los pgTAP, incluidos 05 y 27, y la matriz de seguridad por HTTP).
3. **Funciones de Edge** que cambiaron (y las que dependen de `_shared/` que cambió): `SUPABASE_ACCESS_TOKEN=… npx supabase functions deploy <nombre …> --project-ref <ref> --use-api` (el token sale de `.env.e2e`; **no lo pegues en ningún chat**).
4. **La tienda:** `git push origin main`. El CI (`quality`: secretos, lint, formato, tipos, pruebas y compilación) corre solo; Vercel publica al terminar.
5. **Después de subir:** `npm run smoke -- https://<dominio>` (25 comprobaciones de solo lectura: portada y cabeceras de seguridad, robots, mapa del sitio, feeds, rutas privadas con `noindex`, bundle sin claves, CORS, tablas cerradas, catálogo abierto, Auth) y `npm run health`.

**Orden entre piezas:** migración → funciones → tienda. Una migración nunca debe romper a la versión anterior de la tienda (se añaden columnas y funciones; no se quitan hasta una subida posterior). `npx supabase config push` **no se usa**: trae valores de desarrollo.

## Volver atrás

| Qué | Cómo |
| --- | --- |
| La tienda | En Vercel → Deployments → el despliegue anterior → «Instant Rollback» / «Promote to Production» (instantáneo y no toca la base; qué tan atrás se puede ir depende de tu plan de Vercel). O `git revert` del commit y push (tarda lo de una compilación) |
| Una función de Edge | Volver a desplegar la versión anterior desde su commit (`git checkout <commit> -- supabase/functions` y `functions deploy`) |
| Una migración | Las migraciones recientes traen su **rollback escrito en el encabezado** (qué `drop` y `revoke` hay que correr). Se prueba en la transacción de ensayo. Una migración que ya recibió datos nuevos no se revierte a ciegas: se escribe otra que corrija |
| Datos | No hay vuelta atrás de datos sin copia: ver `docs/runbooks.md` §11 (**hoy el proyecto no tiene copias**; es un bloqueante de lanzamiento) |
| Un secreto | `docs/runbooks.md` §13 |

## Lista de comprobación antes del lanzamiento

Los bloqueantes de S16 (el detalle y quién lo hace, en `Sprints/SPRINT_19_Acciones_Manuales.md` §U):

- [ ] Cero hallazgos altos de seguridad abiertos (`docs/seguridad.md`: H-01, H-02) y el bloqueante H-03 (SMTP de Auth).
- [ ] Copias de seguridad activas **y una restauración ensayada** en un proyecto vacío.
- [ ] Un entorno de ensayo (o la decisión de no tenerlo) y el vaciado de entrega hecho (`db reset --linked --no-seed`, quitar `pgtap`).
- [ ] Dominio propio con HTTPS, `www`, SPF/DKIM/DMARC; `site_url` y `uri_allow_list` de Auth y `ALLOWED_ORIGINS` con ese dominio y **sin** `localhost` (`npm run security:auth-config -- --launch`).
- [ ] Textos legales aprobados y publicados (S15), IDs de Meta y Google, secretos de Resend y del vault.
- [ ] `npm run health` sin críticos y `npm run smoke` al 100 % contra el dominio final.
- [ ] Dos administradores con acceso probado y los runbooks a mano.
- [ ] Un pedido real de bajo monto de punta a punta (pago, WhatsApp, entrega, reembolso).
