/** Textos del reporte de redenciones (usos de descuentos) del panel de Descuentos (S9). */
export const adminDiscountsRedemptions = {
  title: "Redenciones",
  description:
    "Cada vez que una clienta usa un descuento queda aquí un registro: quién, cuándo y cuánto se descontó. Solo puedes verlo y descargarlo; no se edita.",
  filters: {
    label: "Filtros",
    discount: "Descuento",
    allDiscounts: "Todos los descuentos",
    archivedName: "{name} (archivado)",
    status: "Estado",
    allStatuses: "Todos los estados",
    clear: "Quitar filtros",
  },
  status: {
    reserved: "Reservado",
    applied: "Aplicado",
    reverted: "Devuelto",
  },
  statusHelp: {
    summary: "¿Qué significa cada estado?",
    reserved:
      "Reservado: la clienta lo usó al hacer su pedido y todavía no se confirma. Ya cuenta como un uso.",
    applied: "Aplicado: el pedido se confirmó y el descuento se cobró.",
    reverted:
      "Devuelto: el pedido no siguió adelante y el uso se liberó. No cuenta como uso ni se suma al total.",
  },
  columns: {
    date: "Fecha (hora de La Paz)",
    discount: "Descuento",
    code: "Código usado",
    customer: "Clienta",
    owner: "Pedido",
    amount: "Monto descontado",
    status: "Estado",
  },
  cells: {
    noCode: "Sin código",
    unknownDiscount: "Descuento no disponible",
    guest: "Sin cuenta (invitada)",
    noName: "Sin nombre",
    owner: {
      order: "Pedido {id}",
      cart: "Bolsa {id}",
      manual: "Manual {id}",
    },
  },
  totals: {
    label: "Totales de lo que ves",
    records: "Registros",
    active: "Usos vigentes",
    amount: "Total descontado",
    amountNote: "No cuenta los devueltos.",
  },
  limitNotice:
    "Mostrando las últimas {count} redenciones. Puede haber más antiguas que no aparecen aquí ni en el archivo: filtra por descuento para ver las de uno solo.",
  export: {
    button: "Descargar CSV",
    hint: "El archivo trae lo que ves ahora, con los filtros aplicados. Si tu programa de hojas de cálculo lo muestra todo en una sola columna, impórtalo con la coma como separador (en Excel: Datos > Desde un archivo de texto o CSV).",
    done: "Descargamos el archivo con {count} redenciones.",
    fileName: "redenciones",
    headers: {
      date: "Fecha (hora de La Paz)",
      discount: "Descuento",
      code: "Código usado",
      customer: "Clienta",
      email: "Correo",
      ownerType: "Origen",
      ownerId: "Referencia",
      amount: "Monto descontado",
      currency: "Moneda",
      status: "Estado",
    },
    ownerType: {
      order: "Pedido",
      cart: "Bolsa",
      manual: "Manual",
    },
  },
  empty: "Todavía no hay redenciones. Aparecerán aquí cuando una clienta use un descuento.",
  noMatches: "Ninguna redención coincide con los filtros.",
} as const;
