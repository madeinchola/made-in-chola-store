-- Sprint 1 · rate limit: ventana, aislamiento por clave, expiración, permisos.
begin;
select plan(20);

-- HERMÉTICO: el test parte de una BD vacía DENTRO de su transacción (se revierte al final con el rollback),
-- así no depende de los usuarios del seed ni de datos de pruebas anteriores, y no los toca.
delete from public.profiles;
alter table public.audit_log disable trigger audit_log_no_change;
delete from public.audit_log;
alter table public.audit_log enable trigger audit_log_no_change;
delete from auth.users;
delete from public.rate_limits;

-- Máximo 3 por ventana: el intento 4 es el primero rechazado
select is((select allowed from public.check_rate_limit('k1', 3, 60)), true,  'intento 1 permitido');
select is((select allowed from public.check_rate_limit('k1', 3, 60)), true,  'intento 2 permitido');
select is((select allowed from public.check_rate_limit('k1', 3, 60)), true,  'intento 3 permitido (el máximo)');
select is((select allowed from public.check_rate_limit('k1', 3, 60)), false, 'intento 4 (N+1) RECHAZADO');
select is((select hit_count from public.check_rate_limit('k1', 3, 60)), 5, 'los intentos rechazados también se cuentan');
select ok((select retry_after_seconds from public.check_rate_limit('k1', 3, 60)) between 1 and 60, 'retry_after está dentro de la ventana');

-- Aislamiento
select is((select allowed from public.check_rate_limit('k2', 3, 60)), true, 'otra clave no se ve afectada');

-- Expiración de ventana: se simula envejeciendo la fila
update public.rate_limits set window_start = now() - interval '61 seconds' where key = 'k1';
select is((select allowed from public.check_rate_limit('k1', 3, 60)), true, 'pasada la ventana se permite de nuevo');
select is((select hit_count from public.check_rate_limit('k1', 3, 60)), 2, '…y el contador reinició (1 → 2)');
update public.rate_limits set window_start = now() - interval '59 seconds' where key = 'k1';
select is((select hit_count from public.check_rate_limit('k1', 3, 60)), 3, 'a 59 s de 60 la ventana sigue vigente (no reinicia antes de tiempo)');

-- Reset (login exitoso)
select public.reset_rate_limit('k1');
select is((select count(*)::int from public.rate_limits where key = 'k1'), 0, 'reset_rate_limit borra la clave');
select is((select hit_count from public.check_rate_limit('k1', 3, 60)), 1, '…y empieza de cero');

-- Parámetros inválidos
select throws_ok($$select * from public.check_rate_limit('', 3, 60)$$, '22023', null, 'clave vacía rechazada');
select throws_ok($$select * from public.check_rate_limit('k', 0, 60)$$, '22023', null, 'máximo 0 rechazado');
select throws_ok($$select * from public.check_rate_limit('k', 3, 0)$$, '22023', null, 'ventana 0 rechazada');

-- Permisos: solo service_role
set local role anon;
select throws_ok($$select * from public.check_rate_limit('x', 1, 1)$$, '42501', null, 'anon NO ejecuta check_rate_limit');
reset role;
set local role authenticated;
select throws_ok($$select * from public.check_rate_limit('x', 1, 1)$$, '42501', null, 'authenticated NO ejecuta check_rate_limit (no puede resetear su propio bloqueo)');
select throws_ok($$select public.reset_rate_limit('k1')$$, '42501', null, 'authenticated NO ejecuta reset_rate_limit');
select throws_ok($$select * from public.rate_limits$$, '42501', null, 'authenticated NO lee rate_limits');
reset role;

select is((select count(*)::int from cron.job where jobname = 'rate_limits_cleanup'), 1, 'limpieza diaria programada en pg_cron');

select * from finish();
rollback;
