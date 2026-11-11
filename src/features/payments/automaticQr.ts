/**
 * Cobro QR AUTOMÁTICO (proveedor `qr_api`): el CÓDIGO ya lo soporta de punta a punta (base de datos, aviso firmado `payment-webhook`,
 * conciliación `payment-reconcile`, registro de proveedores), pero la INTERFAZ no lo ofrece ni lo menciona mientras no haya un
 * proveedor de cobro elegido: hoy solo se cobra con el QR manual (la clienta sube su comprobante y el administrador lo revisa).
 *
 * Con `false` la interfaz oculta: el método «automático» en Métodos de pago, su opción en el filtro de cobros, el botón «Conciliar
 * ahora», el «Id del proveedor» del detalle y el texto «tu pago se confirma solo» de la pantalla de la clienta.
 *
 * Para encenderlo: poner `true`, elegir proveedor, fijar su secreto (`PAYMENT_WEBHOOK_SECRET_<PROVEEDOR>`) y seguir docs/pagos.md.
 * Se escribe como `boolean` (no como el literal `false`) para que las ramas apagadas se sigan comprobando por tipos.
 */
export const AUTOMATIC_QR_IN_UI = false as boolean;
