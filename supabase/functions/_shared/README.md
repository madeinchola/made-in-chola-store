# _shared

Código común de Edge Functions: `cors`, `errors`, `logger`, `validate`, `supabase`.
Importar con ruta relativa: `import { jsonResponse } from "../_shared/errors.ts"`.

## `notifications/` (Sprint 13)

Motor de las notificaciones, **sin red ni base de datos dentro** (todo entra por interfaces inyectadas, por eso se prueba entero con Deno):
`render.ts` (plantillas: variables, escape HTML, asunto de una línea, enlaces seguros), `layout.ts` (el correo responsive con modo oscuro),
`variables.ts` (variables de cada aviso, dinero y hora de La Paz), `compose.ts` (**una sola** forma de armar un mensaje: la usan el worker y la
vista previa), `preview.ts` (qué impide guardar una plantilla), `providers.ts` (Resend, el proveedor de pruebas y los dominios reservados),
`worker.ts` (el lote: plantilla, destinatarios, proveedor, errores) y `runtime.ts` (lo conecta con Supabase). Las funciones son `notify-worker`
(solo la clave de servicio) y `notify-admin` (vista previa y envío de prueba, solo administradores). Detalle en `docs/notificaciones.md`.
