import { t } from "@/i18n";

export function EnvErrorScreen({ issues }: { issues: readonly string[] }) {
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-destructive/40 bg-muted p-6">
        <h1 className="text-lg font-semibold text-destructive">{t("env.title")}</h1>
        <p className="text-sm">{t("env.body")}</p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("env.hint")}</p>
      </div>
    </div>
  );
}
