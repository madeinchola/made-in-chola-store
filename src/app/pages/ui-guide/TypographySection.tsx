import { Block } from "./Block";

export function TypographySection() {
  return (
    <Block
      id="tipografia"
      title="Tipografía"
      note="Títulos con la serif (Baskervville, provisional) y texto con la sans (Jost, provisional). Cuando se confirme la licencia de las fuentes originales solo cambian fonts.css y los tokens."
    >
      <div className="space-y-4">
        <p className="font-display text-display-xl">Display XL</p>
        <p className="font-display text-display-lg">Display LG</p>
        <p className="font-display text-display-md">Display MD</p>
        <p className="font-display text-display-sm">Display SM</p>
        <p className="eyebrow">Rótulo en mayúsculas</p>
        <p className="max-w-prose text-base">
          Texto corrido: camiseta de algodón pima, corte holgado, confeccionada en Bolivia. Los
          acentos y signos (¿cuánto? ¡nuevo!, ñ, ü) deben verse bien en todos los pesos.
        </p>
        <p className="max-w-prose text-sm font-medium">Texto de énfasis (peso 500).</p>
        <p className="max-w-prose text-sm text-muted-foreground">Texto atenuado de apoyo.</p>
        <p className="font-display text-xl italic">Cursiva de títulos</p>
        <p className="w-40 break-words font-display text-display-sm">
          Pneumonoultramicroscopicsilicovolcanoconiosis_camiseta_oversize
        </p>
      </div>
    </Block>
  );
}
