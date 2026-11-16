import { useState } from "react";
import { t } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "../ui/DataTable";
import { TemplateEditor } from "./TemplateEditor";
import { useInvalidateNotifications, useTemplates } from "./hooks";
import { channelLabel, typeLabel } from "./logic";
import type { TemplateAudience, TemplateRow } from "./types";

const L = "admin.notifications.templates" as const;
const GROUPS: readonly TemplateAudience[] = ["customer", "admin"];

/** Las plantillas de todos los avisos: las de la clienta (correo y WhatsApp) y las alertas internas. Se editan una por una. */
export function TemplatesPage() {
  const query = useTemplates();
  const invalidate = useInvalidateNotifications();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const rows = query.data ?? [];

  const columns: Column<TemplateRow>[] = [
    { id: "name", header: t(`${L}.col.name`), cell: (r) => typeLabel(r.key) },
    { id: "channel", header: t(`${L}.col.channel`), cell: (r) => channelLabel(r.channel) },
    {
      id: "state",
      header: t(`${L}.col.state`),
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          <Badge tone={r.active ? "success" : "neutral"}>
            {r.active ? t(`${L}.active`) : t(`${L}.inactive`)}
          </Badge>
          {r.isDefault && <Badge tone="warning">{t(`${L}.review`)}</Badge>}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t(`${L}.col.actions`)}</span>,
      cell: (r) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={t(`${L}.editLabel`, {
            name: typeLabel(r.key),
            channel: channelLabel(r.channel),
          })}
          onClick={() => setEditing(r)}
        >
          {t(`${L}.edit`)}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm text-muted-foreground">{t(`${L}.intro`)}</p>
      {GROUPS.map((audience) => (
        <section key={audience} aria-labelledby={`tpl-group-${audience}`} className="space-y-3">
          <h2 id={`tpl-group-${audience}`} className="text-lg font-semibold">
            {t(`${L}.group.${audience}`)}
          </h2>
          <DataTable
            caption={t(`${L}.caption.${audience}`)}
            columns={columns}
            rows={rows.filter((r) => r.audience === audience)}
            getRowId={(r) => String(r.id)}
            loading={query.isLoading}
            error={query.isError}
            onRetry={() => void query.refetch()}
          />
        </section>
      ))}
      <TemplateEditor
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void invalidate();
        }}
      />
    </div>
  );
}
