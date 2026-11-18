/**
 * Panel de Textos legales (Sprint 15): los cinco documentos que ve la clienta (términos, privacidad, cookies, envíos y devoluciones),
 * con borradores, vista previa, publicación con fecha de vigencia e historial. Publicar es una decisión del dueño, no de la
 * programación: los textos de partida llevan una marca que impide publicarlos sin haberlos leído.
 */
export const adminLegal = {
  title: "Textos legales",
  description:
    "Términos, privacidad, cookies, envíos y devoluciones: lo que lee tu clienta y lo que acepta al registrarse y al pagar. Cada cambio es una versión nueva con su fecha de vigencia; las versiones publicadas no se pueden modificar.",
  warning: {
    title: "Antes de publicar",
    body: "Los textos de partida los redactó el equipo de desarrollo, no un abogado. Pide que los revise un abogado y completa los datos que faltan; el panel no deja publicar mientras el texto tenga la marca de borrador o algún [COMPLETAR…].",
  },
  business: {
    title: "Datos del negocio",
    missing:
      "Los textos citan estos datos y todavía no están definidos: {list}. Complétalos en Ajustes.",
    complete: "Los datos del negocio están completos.",
    link: "Ir a Ajustes",
    names: {
      razon_social: "razón social",
      nit: "NIT",
      direccion: "dirección",
      correo: "correo de contacto",
      telefono: "teléfono de contacto",
    },
  },
  list: {
    caption: "Documentos legales",
    col: {
      document: "Documento",
      acceptance: "Aceptación",
      current: "Vigente",
      draft: "Borrador",
      actions: "Acciones",
    },
    requires: "Se acepta al registrarse y pagar",
    informative: "Informativo",
    notPublished: "Sin publicar",
    currentValue: "Versión {version} desde el {date}",
    hasDraft: "Hay un borrador",
    noDraft: "—",
    edit: "Editar",
    editLabel: "Editar {title}",
    view: "Ver en la tienda",
  },
  editor: {
    back: "Volver a los textos legales",
    notFound: "Ese documento no existe.",
    tabs: { label: "Modo del editor", edit: "Editar", preview: "Vista previa" },
    body: "Texto del documento",
    bodyHelp:
      "Títulos con #, listas con - o 1., **negrita** y [enlaces](https://…). Datos del negocio con {{razon_social}}, {{nit}}, {{direccion}}, {{correo}} y {{telefono}}. No se admite HTML.",
    note: "¿Qué cambió?",
    noteHelp:
      "Se le muestra a la clienta cuando le pedimos que acepte la versión nueva. Obligatorio desde la segunda versión.",
    source: {
      draft: "Estás editando el borrador de la versión {version}.",
      published:
        "Nuevo borrador a partir de la versión {version} vigente: al guardarlo será la versión {next}.",
      starter:
        "Todavía no hay ninguna versión. Este es un texto de partida para que no empieces de cero: léelo, complétalo y pide que lo revise un abogado.",
    },
    current: "Vigente: versión {version} desde el {date}.",
    nothingCurrent:
      "Todavía no hay una versión vigente: la clienta ve «Este documento todavía no está publicado».",
    save: "Guardar borrador",
    saving: "Guardando…",
    saved: "Borrador guardado.",
    discard: "Descartar borrador",
    discarded: "Borrador descartado.",
    discardTitle: "¿Descartar el borrador?",
    discardBody: "Se borra el borrador de la versión {version}. La versión vigente no cambia.",
    publish: "Publicar…",
    publishNeedsSave: "Guarda el borrador para poder publicarlo.",
    unsaved: "Hay cambios sin guardar.",
    counter: "{count} de 60 000 caracteres",
    startOver: "Usar el texto de partida",
    previewEmpty: "No hay nada que mostrar todavía.",
    previewNote: "Así lo verá la clienta (con los datos del negocio de Ajustes).",
    problems: {
      unknown: "Variables que no existen: {list}.",
      empty: "Datos del negocio sin definir en Ajustes: {list}.",
      pending: "El texto todavía tiene marcas pendientes: {list}.",
    },
  },
  history: {
    title: "Versiones",
    caption: "Historial de versiones",
    col: {
      version: "Versión",
      status: "Estado",
      effective: "Vigente desde",
      note: "Qué cambió",
      accepted: "Aceptaron",
      actions: "Acciones",
    },
    published: "Publicada",
    draft: "Borrador",
    scheduled: "Programada",
    current: "Vigente",
    replaced: "Reemplazada",
    accepted: "{accounts} cuentas · {orders} pedidos",
    noAccepted: "—",
    noNote: "—",
    view: "Ver",
    viewLabel: "Ver la versión {version}",
    useAsBase: "Usar como base",
    viewTitle: "Versión {version}",
    viewClose: "Cerrar",
    empty: "Todavía no hay versiones publicadas.",
  },
  publish: {
    title: "Publicar la versión {version}",
    description:
      "Al publicarla, esta versión no se puede modificar. Las clientas con cuenta verán un aviso para aceptarla de nuevo, y el pago la exigirá.",
    when: "Desde cuándo rige",
    now: "Desde ahora",
    later: "En una fecha",
    date: "Fecha y hora (hora de La Paz)",
    note: "¿Qué cambió?",
    noteHelp: "Se le muestra a la clienta. Obligatorio desde la segunda versión.",
    confirm: "Publicar",
    publishing: "Publicando…",
    cancel: "Cancelar",
    done: "Versión {version} publicada.",
    blocked: "No se puede publicar todavía",
  },
  stats: {
    title: "Aceptaciones",
    help: "Cuántas cuentas y pedidos aceptaron cada versión.",
  },
  errors: {
    no_draft: "No hay un borrador para publicar. Guárdalo primero.",
    effective_in_past: "La fecha de vigencia no puede estar en el pasado.",
    change_note_required: "Cuenta qué cambió respecto de la versión anterior.",
    invalid_body: "El texto debe tener entre 20 y 60 000 caracteres.",
    html_not_allowed:
      "El texto no admite etiquetas HTML: quita los signos < y > que abren etiquetas.",
    invalid_kind: "Ese documento no existe.",
    unknown: "No se pudo completar la operación. Inténtalo de nuevo.",
  },
} as const;
