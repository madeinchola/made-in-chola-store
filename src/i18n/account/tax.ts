/** Textos de «Mi cuenta» · Datos fiscales. */
export const acctTax = {
  title: "Datos fiscales",
  intro:
    "Son opcionales: los usaremos para emitir tu factura cuando compres. Puedes guardar hasta {max} y elegir uno como predeterminado.",
  count: "{n} de {max} activos",
  add: "Agregar datos fiscales",
  edit: "Editar",
  editNamed: "Editar datos fiscales de {name}",
  archive: "Archivar",
  archiveNamed: "Archivar datos fiscales de {name}",
  restore: "Restaurar",
  restoreNamed: "Restaurar datos fiscales de {name}",
  makeDefault: "Hacer predeterminado",
  makeDefaultNamed: "Hacer predeterminados los datos fiscales de {name}",
  defaultBadge: "Predeterminado",
  list: { active: "Datos fiscales activos", archived: "Datos fiscales archivados" },
  loading: "Cargando tus datos fiscales…",
  capReached:
    "Llegaste al máximo de {max} datos fiscales activos. Archiva alguno para agregar o restaurar otro.",
  empty: {
    title: "Aún no tienes datos fiscales",
    description: "Son opcionales. Agrégalos si quieres que tu factura salga con tu NIT o CI.",
  },
  error: {
    title: "No pudimos cargar tus datos fiscales",
    description: "Revisa tu conexión e inténtalo de nuevo.",
  },
  archived: {
    show: "Mostrar archivados ({n})",
    hide: "Ocultar archivados ({n})",
  },
  docTypes: {
    ci: "Cédula de identidad (CI)",
    nit: "NIT",
    ce: "Carnet de extranjería (CE)",
    pas: "Pasaporte",
    otro: "Otro documento",
  },
  docTypesShort: {
    ci: "CI",
    nit: "NIT",
    ce: "CE",
    pas: "PAS",
    otro: "Otro",
  },
  dialog: {
    createTitle: "Agregar datos fiscales",
    editTitle: "Editar datos fiscales",
    intro: "Se usarán para tu factura. Revisa que el documento esté bien escrito.",
    docType: "Tipo de documento",
    docNumber: "Número de documento",
    legalName: "Razón social o nombre",
    legalNameHint: "Tal como debe salir en la factura.",
    submitCreate: "Guardar",
    submitEdit: "Guardar cambios",
    cancel: "Cancelar",
  },
  hints: {
    strict: {
      ci: "{min} a {max} dígitos, con complemento opcional (por ejemplo 1234567-1A).",
      nit: "{min} a {max} dígitos, solo números.",
      ce: "{min} a {max} letras o números.",
      pas: "{min} a {max} letras o números.",
      otro: "{min} a {max} letras o números.",
    },
    lenient: "Letras, números, espacios, puntos, barras o guiones ({min} a {max} caracteres).",
  },
  archiveDialog: {
    title: "¿Archivar estos datos fiscales?",
    description:
      "Dejarán de ofrecerse al pagar. Podrás restaurarlos cuando quieras desde «Archivados».",
    defaultNote: "Son tus datos predeterminados: los más recientes que queden pasarán a serlo.",
    confirm: "Sí, archivar",
    cancel: "Cancelar",
  },
  messages: {
    created: "Datos fiscales guardados.",
    updated: "Datos fiscales actualizados.",
    archived: "Datos fiscales archivados.",
    restored: "Datos fiscales restaurados.",
    defaulted: "Datos fiscales predeterminados actualizados.",
  },
  errors: {
    empty: "Ingresa el número de documento.",
    legalNameRequired: "Ingresa la razón social o tu nombre.",
    legalNameTooLong: "Máximo {max} caracteres.",
    ci: {
      invalid_format:
        "El CI lleva solo números y, si corresponde, un complemento separado por guion o espacio (por ejemplo 1234567-1A).",
      too_short: "El CI debe tener al menos {min} dígitos.",
      too_long: "El CI debe tener como máximo {max} dígitos.",
    },
    nit: {
      invalid_format: "El NIT lleva solo números.",
      too_short: "El NIT debe tener al menos {min} dígitos.",
      too_long: "El NIT debe tener como máximo {max} dígitos.",
    },
    ce: {
      invalid_format:
        "El carnet de extranjería lleva solo letras y números, sin espacios ni símbolos.",
      too_short: "El carnet de extranjería debe tener al menos {min} caracteres.",
      too_long: "El carnet de extranjería debe tener como máximo {max} caracteres.",
    },
    pas: {
      invalid_format: "El pasaporte lleva solo letras y números, sin espacios ni símbolos.",
      too_short: "El pasaporte debe tener al menos {min} caracteres.",
      too_long: "El pasaporte debe tener como máximo {max} caracteres.",
    },
    otro: {
      invalid_format: "El documento lleva solo letras y números, sin espacios ni símbolos.",
      too_short: "El documento debe tener al menos {min} caracteres.",
      too_long: "El documento debe tener como máximo {max} caracteres.",
    },
    lenient: {
      invalid_format:
        "Usa solo letras, números, espacios, puntos, barras o guiones, y empieza con una letra o un número.",
      too_short: "El documento debe tener al menos {min} caracteres.",
      too_long: "El documento debe tener como máximo {max} caracteres.",
    },
    /** Traducción de los errores de la base de datos. */
    cap: "Llegaste al máximo de {max} datos fiscales activos. Archiva alguno para agregar otro.",
    duplicate: "Ya tienes datos fiscales activos con ese documento.",
    docFormat: "El documento no tiene un formato válido.",
    legalName: "La razón social debe tener entre 1 y {max} caracteres.",
    docType: "El tipo de documento no es válido.",
    conflict: "Los datos cambiaron mientras los editabas. Inténtalo de nuevo.",
    notFound: "Esos datos fiscales ya no existen. Actualiza la página.",
  },
} as const;
