/** Textos del diálogo de códigos (cupones) de un descuento (S9). */
export const adminDiscountsCoupons = {
  title: "Códigos de «{name}»",
  description:
    "Estos son los códigos que tus clientas escriben al pagar. Se comparan sin importar mayúsculas, espacios ni guiones: «Verano-10» y «VERANO 10» son el mismo código.",
  noCodeNeeded:
    "Este descuento se aplica solo, sin código, así que no tiene códigos. Para tener códigos, edita el descuento y haz que pida código.",
  archivedDiscount:
    "Este descuento está archivado: puedes ver y descargar sus códigos, pero no generar códigos nuevos al azar.",
  toolbar: {
    label: "Acciones de los códigos",
    search: "Buscar un código",
    searchPlaceholder: "Por ejemplo VERANO",
    addManual: "Agregar un código",
    generate: "Generar al azar",
    downloadAll: "Descargar todos (CSV)",
  },
  count: {
    one: "1 código",
    many: "{count} códigos",
    filtered: "Mostrando {shown} de {total} códigos",
  },
  columns: {
    code: "Código",
    status: "Estado",
    uses: "Usos",
    validity: "Vigencia",
    actions: "Acciones",
  },
  status: {
    active: "Activo",
    inactive: "Apagado",
    archived: "Archivado",
    expired: "Vencido",
    scheduled: "Aún no empieza",
    exhausted: "Agotado",
  },
  uses: {
    unlimited: "{used} (sin tope)",
    limited: "{used} de {limit}",
    singleUse: "{used} de 1 (un solo uso)",
    unknown: "—",
  },
  usesNotice: {
    error:
      "No pudimos leer cuántas veces se usó cada código: no se muestran los usos ni se sabe si alguno está agotado.",
    truncated:
      "Este descuento tiene {count} usos o más y solo se leen los últimos {count}: los números de «Usos» pueden quedar cortos.",
  },
  validity: {
    none: "Sin fechas propias",
    from: "Desde {date}",
    until: "Hasta {date}",
    range: "Desde {from} hasta {until}",
  },
  actions: {
    copy: "Copiar",
    copyNamed: "Copiar el código {code}",
    turnOff: "Apagar",
    turnOffNamed: "Apagar el código {code}",
    turnOn: "Encender",
    turnOnNamed: "Encender el código {code}",
    editNamed: "Editar la vigencia y el tope del código {code}",
    archiveNamed: "Archivar el código {code}",
    restoreNamed: "Restaurar el código {code}",
  },
  copy: {
    one: "Copiaste el código {code}.",
    many: "Copiaste {count} códigos.",
    failed:
      "No pudimos copiar automáticamente. Selecciona el texto y cópialo con Ctrl+C (o con tu dedo, en el celular).",
  },
  empty: "Este descuento todavía no tiene códigos. Agrega uno a mano o genera varios al azar.",
  noMatches: "Ningún código coincide con «{query}».",
  showMore: "Mostrar más ({count} restantes)",
  confirmArchive: {
    title: "¿Archivar el código {code}?",
    body: "Las clientas ya no podrán usarlo. Los pedidos que ya lo usaron no cambian. El código sigue reservado: no se puede crear otro igual. Podrás restaurarlo cuando quieras.",
    confirm: "Archivar código",
  },
  toasts: {
    created: "Código {code} agregado.",
    updated: "Código actualizado.",
    turnedOn: "Código encendido.",
    turnedOff: "Código apagado.",
    archived: "Código archivado.",
    restored: "Código restaurado.",
    generatedOne: "Se generó 1 código.",
    generatedMany: "Se generaron {count} códigos.",
    downloaded: "Descargamos el archivo con {count} códigos.",
  },
  fields: {
    code: "Código",
    codeHint:
      "De 4 a 32 caracteres (los guiones no cuentan): letras sin tilde, números y guion. Empieza con una letra o un número. Por ejemplo VERANO-10.",
    codeSameAs: "Se compara como «{normalized}»: otro código que quede igual no se podrá crear.",
    isActive: "Código encendido",
    isActiveHint: "Apágalo si no quieres que sirva por ahora.",
    startsAt: "Empieza (hora de La Paz)",
    endsAt: "Termina (hora de La Paz)",
    windowHint:
      "Opcional. El código sirve desde el momento exacto en que empieza hasta justo antes del momento en que termina. Si lo dejas vacío, solo rigen las fechas del descuento.",
    usageLimit: "Usos máximos de este código",
    usageLimitHint:
      "Vacío = sin tope. Con 1, el código sirve una sola vez (en total, no por clienta).",
  },
  errors: {
    codeRequired: "Escribe el código.",
    codeTooShort: "El código necesita al menos 4 letras o números (los guiones no cuentan).",
    codeTooLong: "El código admite hasta 32 caracteres.",
    codeChars: "Usa solo letras sin tilde, números y guion: sin espacios ni otros símbolos.",
    codeStart: "El código debe empezar con una letra o un número.",
    codeDuplicate:
      "Ya existe un cupón con ese código (se comparan sin importar mayúsculas, espacios ni guiones).",
    codeDuplicateOf:
      "Ya existe un cupón con ese código (se comparan sin importar mayúsculas, espacios ni guiones). Choca con «{other}».",
    dateInvalid: "Elige una fecha y una hora válidas.",
    endBeforeStart: "El final debe ser después del inicio.",
    limitInvalid: "Escribe un número entero de 1 en adelante, o deja el campo vacío.",
  },
  manual: {
    title: "Agregar un código a mano",
    submit: "Agregar código",
    submitting: "Agregando…",
    close: "Cerrar",
  },
  generate: {
    title: "Generar códigos al azar",
    description:
      "El sistema inventa códigos difíciles de adivinar, sin los caracteres que se confunden (0, O, 1, I, L). Sirve para repartir un código distinto a cada persona.",
    count: "Cantidad de códigos",
    countHint: "De 1 a 500 por vez.",
    prefix: "Prefijo (opcional)",
    prefixHint:
      "Hasta 8 letras sin tilde o números. Se guarda en mayúsculas y va antes del código, por ejemplo VERANO-K7M2QX4P.",
    length: "Largo de cada código",
    lengthHint: "De 6 a 20 caracteres, sin contar el prefijo.",
    singleUse: "Un solo uso por código",
    singleUseHint:
      "Cada código sirve una vez y queda agotado. Sin marcar, los códigos no tienen tope propio.",
    submit: "Generar códigos",
    submitting: "Generando…",
    close: "Cerrar",
    errors: {
      countRequired: "Escribe cuántos códigos quieres.",
      countInvalid: "La cantidad debe ser un número entero de 1 a 500.",
      prefixInvalid: "El prefijo admite solo letras sin tilde y números, hasta 8.",
      lengthInvalid: "El largo debe ser un número entero de 6 a 20.",
    },
  },
  result: {
    titleOne: "Se generó 1 código",
    titleMany: "Se generaron {count} códigos",
    description: "Cópialos o descárgalos ahora. También quedan en la lista de códigos.",
    listLabel: "Códigos generados",
    copyAll: "Copiar todos",
    downloadCsv: "Descargar CSV de lo generado",
    done: "Listo",
  },
  edit: {
    title: "Editar el código {code}",
    description: "El código en sí no se cambia: si te equivocaste, archívalo y crea otro.",
    submit: "Guardar cambios",
    submitting: "Guardando…",
  },
  csv: {
    code: "Código",
    limit: "Tope de usos",
    startsAt: "Empieza (hora de La Paz)",
    endsAt: "Termina (hora de La Paz)",
  },
} as const;
