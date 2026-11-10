/** Textos del asistente de creación y edición de un descuento (el diálogo de «Descuentos»). */
export const adminDiscountsWizard = {
  createTitle: "Nuevo descuento",
  editTitle: "Editar descuento",
  step1: "Paso 1 de 2: elige qué tipo de descuento quieres crear.",
  step2: "Paso 2 de 2: completa los datos de «{kind}».",
  editDescription:
    "El tipo, el alcance y la moneda no se pueden cambiar después de crear el descuento. Si necesitas otro tipo, crea un descuento nuevo.",
  typesLabel: "Tipos de descuento",
  typeSummary: {
    percent: "Un porcentaje menos en el pedido, que la clienta activa escribiendo un código.",
    fixed: "Una cantidad de dinero menos en el pedido, que la clienta activa con un código.",
    free_shipping: "No se cobra el envío: siempre o desde cierto monto de compra.",
    bogo: "La clienta se lleva varias unidades y paga menos: 2×1, 3×2…",
    volume: "Cuantas más unidades lleva la clienta, más porcentaje de descuento.",
    group_price: "Un porcentaje menos solo para un grupo de clientas, por ejemplo las mayoristas.",
    flash: "Un porcentaje menos solo entre dos momentos: empieza y termina a una hora exacta.",
    first_purchase: "Un porcentaje menos para quien compra por primera vez.",
  },
  back: "Atrás",
  fixedKind: "Tipo: {kind}. No se puede cambiar después de crear el descuento.",
  fixedScope: "Alcance: {scope}. No se puede cambiar después de crear el descuento.",
  fixedCurrency: "Moneda: {currency}. No se puede cambiar después de crear el descuento.",
  currency: "Moneda",
  currencyHint:
    "Los montos y el pedido mínimo se definen en esta moneda. No se puede cambiar después.",
  invalidParams:
    "Los datos guardados de este descuento no se pueden leer: vuelve a ingresarlos y guarda.",

  name: "Nombre",
  nameHint:
    "Así lo reconoces en la lista, por ejemplo «Verano 10 %». La clienta puede verlo en su bolsa, así que escríbelo claro.",

  preview: {
    title: "Así se leerá",
    empty: "Completa los datos para ver cómo se leerá este descuento.",
  },

  percent: "Porcentaje de descuento (%)",
  percentHint: "Por ejemplo 10 o 12,5. Hasta 2 decimales.",
  maxAmount: "Tope del descuento ({symbol})",
  maxAmountHint: "Opcional. Lo máximo que se descuenta en un pedido; vacío = sin tope.",
  amount: "Monto del descuento ({symbol})",
  amountHint: "Cuánto se descuenta del pedido, por ejemplo 20 o 12,50.",
  take: "La clienta se lleva (unidades)",
  takeHint: "Entre 2 y 20.",
  pay: "y paga (unidades)",
  payHint: "Menos de las que se lleva. En un 2×1 se paga 1.",
  bogoNote: "Si los productos tienen precios distintos, se regala el más barato de cada grupo.",

  tiers: {
    legend: "Tramos por cantidad",
    hint: "Cuantas más unidades lleve la clienta, más descuento. Cada tramo empieza en una cantidad mayor que el anterior (desde 2 unidades).",
    tier: "Tramo {n}",
    minQty: "Desde (unidades)",
    percent: "Descuento (%)",
    add: "Agregar tramo",
    remove: "Quitar el tramo {n}",
    count: "{count} de {max} tramos",
  },

  group: "Grupo de clientes",
  groupHint:
    "Solo las clientas de este grupo tienen el descuento. Los grupos se arman en la pestaña «Grupos de clientes».",
  groupPlaceholder: "Elige un grupo",
  groupNone:
    "Todavía no hay grupos de clientes. Crea uno en la pestaña «Grupos de clientes» y vuelve aquí.",
  groupArchived: "{name} (archivado)",
  groupLoading: "Cargando los grupos…",
  groupError: "No pudimos cargar los grupos de clientes.",

  activation: {
    legend: "Cómo se activa",
    automatic: "Automático",
    automaticHint: "Se aplica solo cuando la clienta cumple las condiciones.",
    coupon: "Con código",
    couponHint:
      "La clienta escribe un código en su bolsa. Los códigos se crean después, con el botón «Códigos».",
    always:
      "Con código: la clienta lo activa escribiendo un código. Los códigos se crean después, con el botón «Códigos».",
    never: "Automático: se aplica solo, sin código.",
    switchWarning: "Si lo cambias a automático, los códigos que ya creaste dejan de funcionar.",
  },

  scope: {
    label: "Alcance",
    hint: "A qué productos alcanza el descuento.",
    options: {
      order: "Todo el pedido",
      product: "Productos concretos",
      category: "Categorías",
      collection: "Colecciones",
    },
    shipping: "El envío gratis siempre vale para todo el pedido.",
  },

  targets: {
    legend: {
      product: "Productos del descuento",
      category: "Categorías del descuento",
      collection: "Colecciones del descuento",
    },
    hint: {
      product: "Busca los productos a los que alcanza el descuento y agrégalos.",
      category: "Marca las categorías a las que alcanza el descuento.",
      collection: "Marca las colecciones a las que alcanza el descuento.",
    },
    search: "Buscar producto por nombre o código",
    searchHint: "Escribe al menos 2 letras.",
    searching: "Buscando…",
    noResults: "Ningún producto coincide con lo que escribiste.",
    searchError: "No pudimos buscar productos. Inténtalo de nuevo.",
    add: "Agregar",
    addNamed: "Agregar {name}",
    remove: "Quitar {name}",
    chosen: "Elegidos ({count})",
    none: "Todavía no elegiste ninguno.",
    noOptions: {
      category: "Todavía no hay categorías. Créalas en «Categorías».",
      collection: "Todavía no hay colecciones. Créalas en «Colecciones».",
    },
    archivedTag: "archivada",
    loading: "Cargando lo que ya estaba elegido…",
    loadError: "No pudimos leer lo que ya estaba elegido.",
    unknownProduct: "Producto que ya no se encuentra",
  },

  minOrder: "Pedido mínimo ({symbol})",
  minOrderHint:
    "Opcional. El descuento solo se aplica si el pedido llega a este monto; vacío = sin mínimo.",
  minOrderShippingHint:
    "Opcional. El envío es gratis desde este monto de compra, ya con los descuentos aplicados; vacío = siempre gratis.",

  startsAt: "Empieza (hora de La Paz)",
  endsAt: "Termina (hora de La Paz)",
  startsAtFlash: "Empieza (hora de La Paz, obligatorio)",
  endsAtFlash: "Termina (hora de La Paz, obligatorio)",
  windowHint:
    "Vacío = empieza en cuanto esté activo y no termina nunca. El inicio cuenta desde esa hora exacta y el fin deja de valer a esa hora exacta.",
  windowFlashHint:
    "Una oferta flash necesita inicio y fin. Empieza a la hora de inicio y deja de valer a la hora de fin.",

  usageLimitTotal: "Máximo de usos en total",
  usageLimitTotalHint: "Opcional. Al llegar a este número el descuento se agota.",
  usageLimitPerCustomer: "Máximo de usos por clienta",
  usageLimitPerCustomerHint: "Opcional. Por ejemplo 1 para que cada clienta lo use una sola vez.",
  priority: "Prioridad",
  priorityHint: "De 0 a 100.000. Si dos descuentos empatan, gana el de mayor prioridad.",

  stackable: "Se suma a las ofertas automáticas",
  stackableHint:
    "Si no lo marcas, cuando el pedido ya tiene una oferta automática se aplica la mejor de las dos: el cupón o la oferta.",
  excludeSale: "No aplicar a productos ya rebajados",
  excludeSaleHint:
    "El cupón no toca los productos que ya tienen una oferta automática, y esa oferta se conserva: en esos productos no compiten.",
  active: "Activo",
  activeHint: "Si lo desmarcas, queda guardado pero la tienda no lo aplica.",

  submitCreate: "Crear descuento",
  submitEdit: "Guardar cambios",
  submitting: "Guardando…",
  toasts: { created: "Descuento creado.", updated: "Descuento actualizado." },

  done: {
    title: "Descuento creado",
    body: "«{name}» ya está creado.",
    needsCodes:
      "Se activa con un código y todavía no tiene ninguno: hasta que agregues uno, nadie puede usarlo.",
    targetsFailed:
      "Pero no pudimos agregar a su alcance: {names}. {reason} Cierra esta ventana, pulsa «Editar» en el descuento y vuelve a elegirlos.",
    deactivated:
      "Lo dejamos DESACTIVADO para que no se aplique a medias: actívalo desde la lista cuando termines.",
    deactivateFailed:
      "ATENCIÓN: tampoco pudimos desactivarlo y está ENCENDIDO con un alcance incompleto: desactívalo desde la lista ahora.",
    openCodes: "Agregar códigos",
    close: "Cerrar",
  },
  editTargetsFailed:
    "Se guardaron los cambios del descuento, pero no pudimos actualizar su alcance: {names}. {reason} Pulsa «Guardar cambios» para reintentarlo.",

  errors: {
    generic: {
      number: "Escribe un número, por ejemplo 10 o 12,5.",
      integer: "Escribe un número entero, sin decimales.",
      decimals:
        "Usa como máximo 2 decimales, con coma (por ejemplo 12,50). Para mil escribe 1000, sin punto.",
    },
    name: {
      required: "Escribe un nombre para el descuento.",
      too_long: "El nombre puede tener hasta 80 caracteres.",
    },
    percent: {
      required: "Escribe el porcentaje.",
      range: "Debe ser mayor que 0 y no pasar de 100.",
    },
    maxAmount: { range: "Debe ser mayor que 0 y menor que 1.000.000.000." },
    amount: {
      required: "Escribe el monto del descuento.",
      range: "Debe ser mayor que 0 y menor que 1.000.000.000.",
    },
    take: {
      required: "Escribe cuántas unidades se lleva la clienta.",
      range: "Debe estar entre 2 y 20.",
    },
    pay: {
      required: "Escribe cuántas unidades paga la clienta.",
      range: "Debe ser 1 o más.",
      not_below_take: "Debe ser menor que las unidades que se lleva.",
    },
    tierQty: {
      required: "Escribe desde cuántas unidades.",
      range: "Debe estar entre 2 y 10.000.",
      order: "Debe ser mayor que la cantidad del tramo anterior.",
    },
    tiers: {
      none: "Agrega al menos un tramo.",
      too_many: "Puedes poner hasta 10 tramos.",
    },
    group: { required: "Elige el grupo de clientes." },
    targets: {
      product: "Elige al menos un producto.",
      category: "Elige al menos una categoría.",
      collection: "Elige al menos una colección.",
    },
    scope: {
      bogo_order:
        "El 2×1 necesita productos, categorías o colecciones: no vale para todo el pedido.",
      shipping_scope: "El envío gratis siempre vale para todo el pedido.",
    },
    minOrder: { range: "Debe ser 0 o más y menor que 10.000.000.000." },
    startsAt: {
      invalid: "La fecha de inicio no es válida.",
      required: "La oferta flash necesita fecha y hora de inicio.",
    },
    endsAt: {
      invalid: "La fecha de fin no es válida.",
      required: "La oferta flash necesita fecha y hora de fin.",
      before_start: "El fin debe ser posterior al inicio.",
    },
    usageLimitTotal: { range: "Debe ser 1 o más." },
    usageLimitPerCustomer: { range: "Debe ser 1 o más." },
    priority: {
      required: "Escribe la prioridad.",
      range: "Debe estar entre 0 y 100.000.",
    },
  },
} as const;
