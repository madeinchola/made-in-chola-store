import { ChevronDown } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { navItemClass } from "./headerStyles";

/**
 * Selector de país «BOLIVIA ⌄» del diseño. Hoy solo hay un país (el multi-país llega en S18), así que es un
 * `<select>` nativo con una única opción: accesible y operable con teclado, sin inventar una interfaz.
 */
export function CountrySelect({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className="relative hidden lg:block">
      <select
        aria-label={t("layout.header.countryLabel")}
        defaultValue="BO"
        className={cn(
          navItemClass(overlay),
          "cursor-pointer appearance-none rounded-sm bg-transparent pr-5",
        )}
      >
        <option value="BO" className="normal-case tracking-normal text-foreground">
          {t("layout.header.country")}
        </option>
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
      />
    </div>
  );
}
