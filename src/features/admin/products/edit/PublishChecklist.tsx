import { Check, TriangleAlert, X } from "lucide-react";
import { t } from "@/i18n";
import type { PublishChecks } from "../publishChecks";

type Row = { label: string; ok: boolean; blocking: boolean };

/** Lista de lo que le falta a un producto antes de publicarlo. El estado va SIEMPRE en texto, no solo en icono/color. */
export function PublishChecklist({ checks }: { checks: PublishChecks }) {
  const rows: Row[] = [
    { label: t("admin.products.edit.publishChecklist.price"), ok: checks.price, blocking: true },
    {
      label: t("admin.products.edit.publishChecklist.variants"),
      ok: checks.variants,
      blocking: true,
    },
    { label: t("admin.products.edit.publishChecklist.images"), ok: checks.images, blocking: false },
    { label: t("admin.products.edit.publishChecklist.stock"), ok: checks.stock, blocking: false },
  ];
  return (
    <ul className="space-y-1 text-sm" aria-label={t("admin.products.edit.publishChecklist.title")}>
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          {r.ok ? (
            <Check className="h-4 w-4 text-success" aria-hidden="true" />
          ) : r.blocking ? (
            <X className="h-4 w-4 text-destructive" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" />
          )}
          <span>{r.label}</span>
          <span className="text-muted-foreground">
            (
            {r.ok
              ? t("admin.products.edit.publishChecklist.ok")
              : r.blocking
                ? t("admin.products.edit.publishChecklist.pending")
                : t("admin.products.edit.publishChecklist.warning")}
            )
          </span>
        </li>
      ))}
    </ul>
  );
}
