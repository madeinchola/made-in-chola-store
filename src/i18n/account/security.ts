/** Textos de «Mi cuenta» · Seguridad (cambio de contraseña, desactivar cuenta) y del indicador de fortaleza. */
export const acctSecurity = {
  title: "Seguridad",
  intro: "Protege tu cuenta: cambia tu contraseña o desactívala si ya no la quieres.",
  wait: {
    second: "{n} segundo",
    seconds: "{n} segundos",
    minutes: "{n} minutos",
  },
  /** Errores comunes de las operaciones que piden la contraseña actual (también los usa el perfil). */
  errors: {
    rate_limited: "Demasiados intentos. Vuelve a intentarlo en {wait}.",
    session: "Tu sesión venció. Inicia sesión de nuevo para continuar.",
    invalid_credentials: "La contraseña actual no es correcta.",
    same_password: "La contraseña nueva debe ser distinta de la actual.",
    last_admin:
      "Eres la única persona administradora de la tienda: nombra a otra antes de desactivar tu cuenta.",
    required: "Escribe tu contraseña actual para continuar.",
  },
  /** Indicador de fortaleza (componente PasswordStrength). */
  strength: {
    label: "Seguridad de la contraseña",
    hintsTitle: "Para que sea válida:",
    predictable:
      "Evita secuencias (abcd, 1234) y repeticiones (aaaa, abab): suman muy poco a la seguridad.",
    levels: {
      weak: "Débil",
      fair: "Aceptable",
      good: "Buena",
      strong: "Fuerte",
    },
  },
  password: {
    title: "Cambiar contraseña",
    intro: "Por seguridad, pedimos tu contraseña actual. La nueva debe ser distinta.",
    current: "Contraseña actual",
    next: "Nueva contraseña",
    confirm: "Repite la nueva contraseña",
    submit: "Cambiar contraseña",
    success: "Contraseña actualizada. Cerramos tus otras sesiones por seguridad.",
    successRelogin: "Contraseña actualizada. Inicia sesión de nuevo con la contraseña nueva.",
  },
  deactivate: {
    title: "Desactivar mi cuenta",
    intro: "Si desactivas tu cuenta ya no podrás ingresar ni comprar con ella.",
    keepsTitle: "Qué se conserva",
    keeps:
      "Tus pedidos y sus datos contables (fechas, productos y montos): la tienda los necesita para su contabilidad y para atender garantías o reclamos.",
    changesTitle: "Qué cambia",
    changes:
      "Tu cuenta queda inactiva. Tu nombre, contacto, direcciones y datos fiscales se guardan, pero ya no podrás verlos ni usarlos.",
    anonymize: "Anonimizar también mis datos personales",
    anonymizeHint:
      "Reemplaza tu nombre, email, teléfono, direcciones y datos fiscales por valores genéricos. No se puede deshacer.",
    password: "Contraseña actual",
    passwordHint: "La pedimos para confirmar que eres tú.",
    submit: "Desactivar mi cuenta…",
    confirmTitle: "¿Desactivar tu cuenta?",
    confirmKeep: "Tu cuenta quedará desactivada y se cerrará tu sesión. Tus pedidos se conservan.",
    confirmAnonymize:
      "Además, tu nombre, email, teléfono, direcciones y datos fiscales se reemplazarán por valores anónimos. Esta acción no se puede deshacer.",
    confirm: "Sí, desactivar mi cuenta",
    cancel: "Cancelar",
    done: "Tu cuenta fue desactivada.",
  },
} as const;
