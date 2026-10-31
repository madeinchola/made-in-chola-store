import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { iconClass } from "./headerStyles";
import { storeRoutes } from "./storeRoutes";

/** El catálogo solo busca con 2+ caracteres (igual que `searchProducts`). */
const MIN_LENGTH = 2;

interface SearchSheetProps {
  /** Cabecera sobre el hero: icono blanco. */
  overlay?: boolean;
  /** Ruta de resultados. Sin ella (todavía no existe) el campo queda desactivado con el aviso «próximamente». */
  searchPath?: string | null;
}

/** Buscador en un cajón superior. Al enviar navega a `<searchPath>?q=<texto>`. */
export function SearchSheet({
  searchPath = storeRoutes.search,
  overlay = false,
}: SearchSheetProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!searchPath) return;
    if (text.length < MIN_LENGTH) {
      setError(t("layout.search.tooShort"));
      return;
    }
    setError(undefined);
    setOpen(false);
    navigate(`${searchPath}?q=${encodeURIComponent(text)}`);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("layout.header.search")}
          className={`${iconClass(overlay)} cursor-pointer`}
        >
          <Search className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="top"
        bodyClassName="flex flex-col gap-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      >
        <SheetTitle className="font-display text-display-sm">{t("layout.search.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("layout.search.description")}</SheetDescription>
        <form
          onSubmit={submit}
          noValidate
          className="mx-auto flex w-full max-w-xl items-start gap-2"
        >
          <div className="flex-1">
            <Field label={t("layout.search.label")} error={error}>
              <Input
                type="search"
                name="q"
                value={query}
                disabled={!searchPath}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <Button type="submit" caps disabled={!searchPath} className="mt-[1.625rem]">
            {t("layout.search.submit")}
          </Button>
        </form>
        {!searchPath && (
          <p role="status" className="mx-auto text-sm text-muted-foreground">
            {t("layout.search.soon")}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
