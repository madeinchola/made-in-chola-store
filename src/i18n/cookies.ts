/** Aviso y preferencias de cookies (Sprint 15). Solo aparecen si la tienda tiene alguna herramienta opcional conectada (Pixel de Meta o GA4). */
export const cookies = {
  banner: {
    label: "Aviso de cookies",
    title: "Tu privacidad",
    body: "Usamos las cookies necesarias para que la tienda funcione. Con tu permiso, también usamos cookies de analítica y de marketing para mejorar la tienda y medir nuestra publicidad. Puedes cambiar tu decisión cuando quieras.",
    acceptAll: "Aceptar todas",
    rejectOptional: "Solo las necesarias",
    customize: "Personalizar",
    policy: "Política de cookies",
  },
  preferences: {
    title: "Preferencias de cookies",
    description:
      "Elige qué cookies aceptas. Tu elección se guarda en este navegador y la puedes cambiar cuando quieras.",
    necessary: {
      label: "Necesarias",
      help: "Mantienen tu sesión y tu bolsa y guardan esta elección. Siempre están activas.",
    },
    analytics: {
      label: "Analítica",
      help: "Nos ayudan a entender qué páginas se visitan y dónde se abandona la compra, de forma agregada.",
    },
    marketing: {
      label: "Marketing",
      help: "Permiten medir y mejorar nuestra publicidad en redes sociales.",
    },
    save: "Guardar preferencias",
    acceptAll: "Aceptar todas",
    rejectOptional: "Solo las necesarias",
    cancel: "Cancelar",
    saved: "Preferencias guardadas.",
    footerLink: "Preferencias de cookies",
  },
} as const;
