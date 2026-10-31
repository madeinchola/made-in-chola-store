import type { HomeSection } from "@/features/catalog/types";
import { HomeImage } from "../HomeImage";

/** Imagen a todo el ancho (PDF de Inicio: ≈ 2:1), sin texto. Decorativa salvo que el admin le escriba un `alt`. */
export function BannerSection({ section }: { section: HomeSection }) {
  return (
    <section className="relative aspect-[2/1] overflow-hidden bg-secondary">
      <div className="absolute inset-0">
        <HomeImage media={section.media} />
      </div>
    </section>
  );
}
