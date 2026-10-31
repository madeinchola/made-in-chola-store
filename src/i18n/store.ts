/** Textos de los componentes de producto de la tienda (ProductCard, PriceTag, Gallery…). */
export const store = {
  stock: { in_stock: "Disponible", low: "Pocas unidades", out: "Agotado" },
  price: { was: "Precio anterior:", now: "Precio actual:" },
  swatch: { label: "Color", selected: "Color: {name}", choose: "Elige un color" },
  size: { label: "Talla", soldOut: "(agotada)" },
  quantity: {
    group: "Selector de cantidad",
    input: "Cantidad",
    decrease: "Disminuir cantidad",
    increase: "Aumentar cantidad",
    live: "Cantidad: {n}",
  },
  card: {
    new: "Nuevo",
    soldOut: "Agotado",
    colorsOne: "1 color",
    colors: "{count} colores",
    noImage: "Sin imagen",
  },
  gallery: {
    label: "Imágenes del producto",
    thumbs: "Miniaturas",
    thumb: "Ver imagen {n} de {total}",
    zoom: "Ampliar imagen",
    zoomTitle: "Imagen ampliada",
    zoomDescription: "Usa las flechas del teclado para ver las demás imágenes.",
    prev: "Imagen anterior",
    next: "Imagen siguiente",
    counter: "Imagen {n} de {total}",
    noImage: "Sin imagen",
  },
} as const;
