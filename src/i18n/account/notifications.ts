/** «Mi cuenta» → Notificaciones (Sprint 13): por dónde recibir los avisos del pedido y el consentimiento de marketing (BR-LEG-01). */
export const acctNotifications = {
  title: "Notificaciones",
  intro: "Elige cómo quieres que te escribamos.",
  loading: "Cargando tus preferencias…",
  error: {
    title: "No pudimos cargar tus preferencias",
    description: "Revisa tu conexión e inténtalo de nuevo.",
  },
  orders: {
    title: "Avisos de tus pedidos",
    intro:
      "Te avisamos cuando confirmamos, empacamos, enviamos o entregamos tu pedido, y si algo pasa con tu pago. Estos avisos son parte de tu compra y no se pueden desactivar.",
    legend: "¿Por dónde prefieres recibirlos?",
    auto: "Automático",
    autoHint: "Por correo si tienes uno; si no, por WhatsApp.",
    email: "Correo",
    emailHint: "Te escribimos a {email}.",
    emailMissing: "Agrega un correo en tu perfil para elegir esta opción.",
    whatsapp: "WhatsApp",
    whatsappHint: "Te escribimos al {phone}.",
    whatsappMissing: "Agrega un teléfono en tu perfil para elegir esta opción.",
    fallback:
      "No tienes {channel} guardado, así que por ahora te escribimos por el otro medio. Puedes agregarlo en tu perfil.",
  },
  marketing: {
    title: "Promociones y novedades",
    intro:
      "Hoy no enviamos promociones. Si algún día lo hacemos, solo te escribiremos si lo aceptas aquí, y puedes cambiar de idea cuando quieras.",
    email: "Quiero recibir novedades por correo",
    whatsapp: "Quiero recibir novedades por WhatsApp",
    consentAt: "Aceptaste el {date}.",
  },
  save: "Guardar preferencias",
  saving: "Guardando…",
  saved: "Preferencias guardadas.",
  nothingToSave: "No cambiaste nada.",
} as const;
