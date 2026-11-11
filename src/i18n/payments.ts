/**
 * Textos del pago con QR de la clienta (Sprint 11): el código, el monto exacto, la cuenta regresiva, el comprobante y los
 * estados del pago. Los plazos y los importes los calcula el servidor; aquí solo hay palabras.
 */
export const pay = {
  title: "Paga con QR",
  loading: "Cargando los datos de tu pago…",
  loadError: {
    title: "No pudimos cargar los datos de tu pago",
    description: "Tu pedido está guardado. Revisa tu conexión e inténtalo de nuevo.",
    action: "Reintentar",
  },
  amount: "Monto exacto",
  amountHelp: "Paga exactamente este monto: si es otro, tendremos que revisar tu pago.",
  reference: "Referencia",
  referenceHelp: "Si tu banco te deja escribir un detalle o glosa, pon esta referencia.",
  copy: "Copiar",
  copied: "Copiada",
  copyLabel: "Copiar la referencia {reference}",
  account: "Datos de la cuenta",
  qrAlt: "Código QR para pagar el pedido {number}",
  qrMissing:
    "Todavía no hay un código QR disponible para este método. Escríbenos y te ayudamos con tu pago.",
  steps: {
    title: "Cómo pagar",
    one: "Abre la app de tu banco y escanea el código QR.",
    two: "Paga el monto exacto.",
    manual: "Toma una captura o foto del comprobante y súbela aquí abajo.",
    auto: "Tu pago se confirma solo. Si prefieres, también puedes subir tu comprobante.",
  },
  deadline: {
    label: "Tiempo para pagar",
    left: "Te quedan {time}",
    ended: "El tiempo para pagar terminó.",
    checking: "Verificando el estado de tu pedido…",
    // Para lectores de pantalla: se anuncian solo estos cortes, no cada segundo.
    oneHour: "Queda una hora para pagar.",
    tenMinutes: "Quedan diez minutos para pagar.",
    oneMinute: "Queda menos de un minuto para pagar.",
    over: "El tiempo para pagar terminó.",
  },
  stage: {
    awaiting: {
      title: "Falta tu pago",
      body: "Tu pedido {number} está reservado hasta que venza el tiempo de abajo.",
    },
    proof_pending: {
      title: "Recibimos tu comprobante",
      body: "Lo estamos revisando; te avisamos en cuanto se confirme tu pago. Tu pedido sigue reservado.",
    },
    proof_rejected: {
      title: "No pudimos aceptar tu comprobante",
      body: "Motivo: {reason} — puedes subir otro mientras tu pedido siga reservado.",
      bodyNoReason: "Puedes subir otro mientras tu pedido siga reservado.",
    },
    in_review: {
      title: "Estamos revisando tu pago",
      body: "Tu pago necesita una revisión de nuestra parte (por ejemplo, el monto no coincide). No tienes que hacer nada: te escribimos pronto.",
    },
    paid: {
      title: "Pago confirmado",
      body: "Gracias. Ya estamos con tu pedido {number}.",
    },
    failed: {
      title: "No se pudo completar el pago",
      body: "Tu pedido sigue reservado. Puedes intentar pagar de nuevo.",
    },
    expired: {
      title: "El tiempo para pagar terminó",
      body: "Cancelamos el pedido {number} y devolvimos los productos al inventario. Si todavía los quieres, puedes volver a pedirlos. Si ya habías pagado, escríbenos con tu comprobante y lo resolvemos.",
    },
    cancelled: {
      title: "Este pedido ya no espera pago",
      body: "El pedido {number} está cancelado. Si ya habías pagado, escríbenos con tu comprobante y lo resolvemos.",
    },
    late: {
      title: "Recibimos un pago de un pedido que ya estaba cancelado",
      body: "Lo estamos revisando y te escribimos para devolverte el dinero o resolverlo contigo. No hagas otro pago.",
    },
    late_done: {
      title: "Resolvimos tu pago de un pedido cancelado",
      body: "El pedido {number} estaba cancelado y ya revisamos tu pago. Si tienes dudas sobre tu dinero, escríbenos.",
    },
    disputed: {
      title: "Hay un reclamo sobre este pago",
      body: "Por seguridad no se puede reintentar el pago desde aquí. Escríbenos y lo resolvemos.",
    },
    refunded: {
      title: "Pago reembolsado",
      body: "Te devolvimos el dinero del pedido {number}.",
    },
  },
  upload: {
    title: "Sube tu comprobante",
    help: "Foto, captura o PDF del comprobante de tu banco (hasta 5 MB). Se ven el monto, la fecha y la referencia.",
    choose: "Elegir archivo",
    change: "Cambiar archivo",
    send: "Enviar comprobante",
    sending: "Enviando tu comprobante…",
    sent: "Recibimos tu comprobante. Lo estamos revisando.",
    fileLabel: "Comprobante de pago",
    selected: "Archivo elegido: {name}",
    previewAlt: "Vista previa del comprobante",
    pdfPreview: "Documento PDF",
    problems: {
      empty: "El archivo está vacío. Elige otro.",
      too_large: "El archivo pesa más de 5 MB. Elige uno más liviano.",
      unknown_type: "Solo aceptamos fotos (JPG, PNG o WebP) y PDF.",
      payment_closed:
        "Este pago ya no admite comprobantes (venció, se confirmó o llegaste al máximo de archivos).",
      proof_pending: "Ya tienes un comprobante en revisión. Espera a que lo revisemos.",
      too_many_proofs: "Llegaste al máximo de comprobantes para este pago. Escríbenos.",
      invalid_file:
        "No pudimos leer ese archivo como un comprobante. Prueba con una foto o un PDF.",
      file_missing: "No encontramos el archivo que subiste. Inténtalo otra vez.",
      not_found: "No encontramos ese pago.",
      rate_limited: "Hiciste demasiados intentos seguidos. Espera un momento e inténtalo otra vez.",
      login: "Tu sesión venció. Inicia sesión para continuar.",
      network:
        "No pudimos conectarnos. Revisa tu conexión e inténtalo otra vez: si el archivo ya había subido, no se duplica.",
      unknown: "No pudimos enviar tu comprobante. Inténtalo de nuevo.",
    },
  },
  retry: {
    action: "Intentar pagar de nuevo",
    working: "Preparando un nuevo cobro…",
    problems: {
      order_closed: "Este pedido ya no está pendiente.",
      payment_blocked: "Este pago no se puede reintentar. Escríbenos.",
      payment_open: "Ya tienes un cobro abierto: usa el código de arriba.",
      too_many_attempts: "Llegaste al máximo de intentos para este pedido. Escríbenos.",
      not_retryable: "Este método de pago no se puede reintentar.",
      not_found: "No encontramos ese pedido.",
      login: "Tu sesión venció. Inicia sesión para continuar.",
      rate_limited: "Hiciste demasiados intentos seguidos. Espera un momento e inténtalo otra vez.",
      network: "No pudimos conectarnos. Revisa tu conexión e inténtalo otra vez.",
      unknown: "No pudimos preparar un nuevo cobro. Inténtalo de nuevo.",
    },
  },
  reorder: {
    action: "Volver a pedir",
    working: "Preparando tu bolsa…",
    done: "Volvimos a poner los productos en tu bolsa. Revisa que sigan disponibles.",
    failed: "No pudimos volver a poner los productos en tu bolsa. Inténtalo de nuevo.",
    empty: "Este pedido no tiene productos para volver a pedir.",
  },
} as const;
