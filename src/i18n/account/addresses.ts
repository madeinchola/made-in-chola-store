/**
 * Textos de «Mi cuenta» · Direcciones (`acct.addresses.*`). El bloque `picker` lo usa el selector de ubicación
 * (`components/map/LocationPicker`), pensado para reutilizarse en envíos (S8) y checkout (S10).
 */
export const acctAddresses = {
  title: "Direcciones",
  intro: "Guarda las direcciones donde recibes tus pedidos y las que usas para facturar.",
  add: "Agregar dirección",
  count: "{n} de {max} direcciones activas",
  limitNotice:
    "Alcanzaste el máximo de {max} direcciones activas. Archiva alguna para poder agregar otra.",
  loading: "Cargando tus direcciones…",
  loadError: {
    title: "No pudimos cargar tus direcciones",
    body: "Revisa tu conexión e inténtalo de nuevo.",
  },
  empty: {
    title: "Aún no tienes direcciones",
    body: "Agrega la primera: la usaremos para tus envíos y tu facturación.",
  },
  listLabel: "Mis direcciones",
  card: {
    default: "Predeterminada",
    shipping: "Envío",
    billing: "Facturación",
    withPin: "Con ubicación en el mapa",
    withoutPin: "Sin ubicación en el mapa",
    phone: "Teléfono: {phone}",
    reference: "Referencia: {text}",
    edit: "Editar",
    editAria: "Editar dirección {label}",
    makeDefault: "Marcar como predeterminada",
    makeDefaultAria: "Marcar la dirección {label} como predeterminada",
    archive: "Archivar",
    archiveAria: "Archivar dirección {label}",
    restore: "Restaurar",
    restoreAria: "Restaurar dirección {label}",
  },
  archived: {
    toggle: "Archivadas ({n})",
    hint: "Las direcciones archivadas no se usan en tus compras. Puedes restaurarlas cuando quieras.",
    loadError: "No pudimos cargar las direcciones archivadas.",
    retry: "Reintentar",
    restoreBlocked:
      "No puedes restaurar direcciones mientras tengas {max} activas: archiva alguna primero.",
  },
  archiveDialog: {
    title: "¿Archivar esta dirección?",
    body: "«{label}» dejará de usarse en tus compras. No se elimina: puedes restaurarla desde «Archivadas».",
    defaultNote:
      "Es tu dirección predeterminada: la más reciente de las que te queden pasará a serlo.",
    confirm: "Archivar",
    working: "Archivando…",
    cancel: "Cancelar",
  },
  form: {
    createTitle: "Agregar dirección",
    editTitle: "Editar dirección",
    createIntro: "Los campos con * son obligatorios. La ubicación en el mapa es opcional.",
    editIntro: "Cambia lo que necesites y guarda.",
    label: "Etiqueta *",
    labelHint: "Para reconocerla: Casa, Oficina…",
    recipient: "Quién recibe *",
    phone: "Teléfono de contacto *",
    phoneHint: "Para que quien entrega pueda llamarte.",
    phoneCountry: "Prefijo",
    country: "País *",
    department: "Departamento *",
    departmentOther: "Departamento, estado o provincia",
    departmentChoose: "Elige un departamento",
    city: "Ciudad *",
    line1: "Calle y número *",
    line2: "Edificio, piso o departamento",
    reference: "Referencia",
    referenceHint: "Cómo llegar: «puerta verde, frente a la farmacia».",
    purposeLegend: "Usar esta dirección para *",
    shipping: "Envío",
    billing: "Facturación",
    isDefault: "Usar como mi dirección predeterminada",
    defaultFirst: "Será tu dirección predeterminada.",
    defaultCurrent:
      "Es tu dirección predeterminada. Para cambiarla, marca otra como predeterminada.",
    save: "Guardar dirección",
    saving: "Guardando…",
    cancel: "Cancelar",
    sessionLost:
      "No pudimos guardar porque tu sesión venció o ya no es válida. No cerramos el formulario: lo que escribiste sigue aquí. Inicia sesión de nuevo (puedes hacerlo en otra pestaña) y vuelve a pulsar «Guardar dirección».",
    sessionLink: "Iniciar sesión en otra pestaña",
  },
  messages: {
    created: "Dirección agregada",
    updated: "Dirección actualizada",
    archived: "Dirección archivada",
    restored: "Dirección restaurada",
    defaulted: "«{label}» es ahora tu dirección predeterminada",
  },
  /** Validación del formulario (mismos límites que la base de datos). */
  errors: {
    labelRequired: "Escribe un nombre para reconocer la dirección.",
    labelTooLong: "La etiqueta admite hasta {max} caracteres.",
    recipientRequired: "Escribe quién recibe el pedido.",
    recipientTooLong: "El nombre admite hasta {max} caracteres.",
    line1Required: "Escribe la calle y el número.",
    line1TooLong: "La calle y el número admiten hasta {max} caracteres.",
    line2TooLong: "Este dato admite hasta {max} caracteres.",
    cityRequired: "Escribe la ciudad.",
    cityTooLong: "La ciudad admite hasta {max} caracteres.",
    departmentRequired: "Elige un departamento.",
    departmentInvalid: "Elige un departamento de la lista.",
    departmentTooLong: "Este dato admite hasta {max} caracteres.",
    referenceTooLong: "La referencia admite hasta {max} caracteres.",
    countryInvalid: "Elige un país de la lista.",
    phoneCountryInvalid: "Elige el código de país del teléfono.",
    pinLatMissing: "Escribe también la latitud, o borra la longitud para no usar pin.",
    pinLngMissing: "Escribe también la longitud, o borra la latitud para no usar pin.",
    pinFormat: "Escribe un número con punto o coma decimal, por ejemplo -16.5.",
    pinLatRange: "La latitud debe estar entre -90 y 90.",
    pinLngRange: "La longitud debe estar entre -180 y 180.",
    purposeNone: "Elige al menos un uso: envío o facturación.",
  },
  /** Errores que devuelve la base de datos o la red, traducidos. */
  dbErrors: {
    limit:
      "Alcanzaste el máximo de {max} direcciones activas. Archiva alguna para poder agregar o restaurar otra.",
    phone: "La dirección necesita un teléfono de contacto válido.",
    coords: "La ubicación del mapa no es válida: revisa la latitud y la longitud, o quita el pin.",
    purpose: "Elige al menos un uso para la dirección: envío o facturación.",
    text: "Algún texto de la dirección está vacío o es demasiado largo. Revísalo e inténtalo de nuevo.",
    country: "Ese país no está disponible para entregas.",
    forbidden:
      "No tienes permiso para guardar esta dirección. Tu sesión pudo haber vencido: inicia sesión de nuevo.",
    unauthorized: "Tu sesión venció. Inicia sesión de nuevo.",
    notFound: "No encontramos esa dirección. Recarga la lista e inténtalo otra vez.",
    network: "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.",
  },
  picker: {
    title: "Ubicación en el mapa",
    optional: "Opcional. Si no la marcas, usaremos la referencia escrita.",
    search: {
      label: "Buscar un lugar",
      placeholder: "Ej.: Plaza Murillo, La Paz",
      hint: "Escribe el lugar y pulsa «Buscar» o Intro.",
      privacy:
        "La búsqueda y el mapa usan OpenStreetMap: lo que escribes aquí, el área que ves y tu dirección IP llegan a ese servicio.",
      button: "Buscar",
      searching: "Buscando…",
      tooShort: "Escribe al menos {min} letras para buscar.",
      resultsLabel: "Resultados de la búsqueda",
      resultsOne: "1 resultado. Elígelo para marcarlo en el mapa.",
      resultsMany: "{n} resultados. Elige uno para marcarlo en el mapa.",
      none: "No encontramos ese lugar. Prueba con otro nombre o marca el punto en el mapa.",
      unavailable:
        "No pudimos buscar en este momento. Marca el punto en el mapa o escribe las coordenadas.",
      rateLimited:
        "Hay muchas búsquedas ahora mismo. Espera unos segundos e inténtalo de nuevo, o marca el punto en el mapa.",
      timeout:
        "La búsqueda tardó demasiado. Inténtalo de nuevo, marca el punto en el mapa o escribe las coordenadas.",
      picked: "Punto marcado en el mapa. Arrastra el pin para afinarlo.",
    },
    locate: {
      button: "Usar mi ubicación",
      explain:
        "Usamos tu ubicación solo para marcar el punto en el mapa. No se guarda hasta que guardes la dirección.",
      locating: "Buscando tu ubicación…",
      done: "Marcamos tu ubicación en el mapa.",
      imprecise:
        "Marcamos tu ubicación, pero es aproximada (± {meters} m). Arrastra el pin hasta el sitio exacto.",
      denied:
        "No tenemos permiso para ver tu ubicación. Puedes activarlo en los ajustes del navegador, buscar el lugar o marcarlo en el mapa.",
      unavailable: "No pudimos determinar tu ubicación. Busca el lugar o márcalo en el mapa.",
      timeout:
        "Tu dispositivo tardó demasiado en responder. Inténtalo de nuevo o marca el punto en el mapa.",
      unsupported:
        "Tu navegador no permite obtener la ubicación. Busca el lugar o márcalo en el mapa.",
    },
    pinSet: "Pin colocado: latitud {lat}, longitud {lng}.",
    removePin: "Quitar pin",
    pinRemoved: "Pin quitado: la dirección se guardará sin ubicación en el mapa.",
    map: {
      label: "Mapa para ubicar la dirección",
      pinLabel: "Pin de la dirección",
      instructions:
        "Toca el mapa o arrastra el pin para marcar el punto. Con teclado: enfoca el mapa, muévete con las flechas, acerca o aleja con + y −, y pulsa Intro para colocar el pin en el centro. También puedes escribir las coordenadas.",
      zoomIn: "Acercar el mapa",
      zoomOut: "Alejar el mapa",
      creditTitle: "Leaflet: biblioteca de mapas interactivos",
      loading: "Cargando el mapa…",
      loadFailed:
        "No pudimos cargar el mapa. Puedes escribir las coordenadas o seguir sin pin: la referencia basta.",
      retry: "Reintentar el mapa",
      tilesFailing:
        "Las imágenes del mapa no cargan (¿sin conexión?). La búsqueda y las coordenadas siguen funcionando.",
    },
    coords: {
      legend: "Coordenadas",
      hint: "Alternativa al mapa. Usa punto o coma decimal.",
      lat: "Latitud",
      lng: "Longitud",
      latPlaceholder: "-16.5",
      lngPlaceholder: "-68.15",
    },
  },
} as const;
