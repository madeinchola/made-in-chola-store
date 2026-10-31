import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { catalogKeys } from "@/features/catalog/queryKeys";
import { configKeys } from "./queryKeys";
import { SectionCard } from "../ui/PageHeader";
import { UnsavedChangesGuard } from "../ui/UnsavedChangesGuard";
import { saveSettings, type SettingChange } from "./api";
import { behaviorText, fieldText } from "./settingsText";
import {
  CRITICAL_KEY,
  LOW_KEY,
  SECTIONS,
  SETTING_DEFS,
  normalizeSetting,
  orderChanges,
  settingMessage,
  settingProblem,
  thresholdProblem,
  toJsonValue,
  type SettingDef,
} from "./settingsSchema";
import type { SettingRow } from "./types";

interface Baseline {
  value: string;
  updatedAt: string;
}

const toText = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

interface SettingsFormProps {
  rows: readonly SettingRow[];
  /** El admin pidió descartar sus cambios y cargar la versión actual (tras un conflicto de edición). */
  onReload: () => void;
}

/**
 * Formulario de ajustes por secciones. Valida con las MISMAS reglas que la base, guarda solo lo que cambió (cada clave con
 * control de versión), muestra el error de cada clave y avisa antes de perder cambios. Los datos de entrada se leen una vez:
 * después el formulario lleva su propia versión de cada clave (la devuelve cada guardado).
 */
export function SettingsForm({ rows, onReload }: SettingsFormProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);

  const [baseline, setBaseline] = useState<Record<string, Baseline>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.key, { value: toText(r.value), updatedAt: r.updatedAt }]),
    ),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, toText(r.value)])),
  );
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);

  // Solo se muestran los ajustes que el código conoce Y que existen en la base (no se puede editar lo que no está).
  const defs = useMemo(() => SETTING_DEFS.filter((d) => d.key in baseline), [baseline]);

  const normalized = (def: SettingDef): string => normalizeSetting(def, values[def.key] ?? "");
  // Se compara lo normalizado con lo normalizado: un dato viejo que el admin NO tocó no cuenta como cambio (ni bloquea otros).
  const changedDefs = defs.filter(
    (d) => !d.readOnly && normalized(d) !== normalizeSetting(d, baseline[d.key]?.value ?? ""),
  );
  const dirty = changedDefs.length > 0;

  // Errores del cliente: solo de lo que cambió (un dato viejo ya guardado no debe bloquear otros cambios).
  const clientErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const d of changedDefs) {
      const p = settingProblem(d, normalized(d));
      if (p) errors[d.key] = settingMessage(p);
    }
    // El orden entre umbrales solo se juzga si ambos son válidos por separado y alguno de los dos cambió.
    const low = defs.find((d) => d.key === LOW_KEY);
    const critical = defs.find((d) => d.key === CRITICAL_KEY);
    const touchedThresholds = changedDefs.some((d) => d.key === LOW_KEY || d.key === CRITICAL_KEY);
    if (low && critical && touchedThresholds && !(LOW_KEY in errors) && !(CRITICAL_KEY in errors)) {
      const order = thresholdProblem(normalized(low), normalized(critical));
      if (order) errors[CRITICAL_KEY] = order;
    }
    return errors;
    // `normalized` y `changedDefs` derivan de `values` y `baseline`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, baseline, defs]);

  const errorFor = (key: string): string | undefined => {
    const client = touched.has(key) || submitted ? clientErrors[key] : undefined;
    return serverErrors[key] ?? client;
  };

  const setValue = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    // Al editar una clave se retira su aviso del servidor (ya no corresponde a lo que hay escrito).
    setServerErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _removed, ...rest } = e;
      return rest;
    });
  };
  const touch = (key: string) => setTouched((s) => new Set(s).add(key));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    if (!dirty) {
      toast.info(t("admin.config.settings.nothingToSave"));
      return;
    }
    if (Object.keys(clientErrors).length > 0) {
      // Lleva el foco al primer campo con error para que se vea y se pueda corregir.
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }

    const changes: SettingChange[] = changedDefs.map((d) => ({
      key: d.key,
      value: toJsonValue(d, normalized(d)),
      updatedAt: baseline[d.key]?.updatedAt ?? "",
    }));
    const ordered = orderChanges(changes, baseline[LOW_KEY]?.value ?? "0");

    setSaving(true);
    try {
      const results = await saveSettings(ordered);
      const nextBaseline = { ...baseline };
      const nextValues = { ...values };
      const nextErrors: Record<string, string> = {};
      let failed = 0;
      let sawStale = false;
      for (const r of results) {
        const def = defs.find((d) => d.key === r.key);
        if (r.ok && def) {
          nextBaseline[r.key] = { value: normalized(def), updatedAt: r.updatedAt };
          nextValues[r.key] = normalized(def); // el campo muestra lo que de verdad se guardó
        } else if (!r.ok) {
          failed += 1;
          if (r.stale) sawStale = true;
          nextErrors[r.key] = r.stale
            ? t("admin.config.settings.errors.staleKey")
            : t("admin.config.settings.errors.saveKey", { message: r.error.message });
        }
      }
      setBaseline(nextBaseline);
      setValues(nextValues);
      setServerErrors((e) => ({ ...e, ...nextErrors }));
      setStale(sawStale);
      const done = results.length - failed;
      if (done > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
          queryClient.invalidateQueries({ queryKey: configKeys.settings() }),
        ]);
      }
      if (failed === 0) toast.success(t("admin.config.settings.saved"));
      else toast.error(t("admin.config.settings.errors.someFailed", { done, failed }));
    } finally {
      setSaving(false);
    }
  };

  const renderField = (def: SettingDef) => {
    const { label, hint } = fieldText(def.key);
    const error = errorFor(def.key);
    const value = values[def.key] ?? "";
    const common = {
      value,
      onChange: (e: { target: { value: string } }) => setValue(def.key, e.target.value),
      onBlur: () => touch(def.key),
    };
    const hintText = def.readOnly ? t("admin.config.settings.readOnly") : hint;
    const wide = def.control === "textarea";
    return (
      <div key={def.key} className={wide ? "sm:col-span-2" : undefined}>
        <Field
          label={label}
          {...(hintText ? { hint: hintText } : {})}
          {...(error ? { error } : {})}
        >
          {def.control === "textarea" ? (
            <Textarea rows={4} {...common} />
          ) : def.control === "select" ? (
            <Select {...common}>
              {(def.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {behaviorText(o)}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              type="text"
              inputMode={
                def.type === "phone_e164"
                  ? "tel"
                  : def.type === "url"
                    ? "url"
                    : def.control === "number"
                      ? "numeric"
                      : def.type === "email"
                        ? "email"
                        : "text"
              }
              autoComplete="off"
              readOnly={def.readOnly === true}
              aria-readonly={def.readOnly === true ? true : undefined}
              {...common}
            />
          )}
        </Field>
      </div>
    );
  };

  return (
    <form ref={formRef} onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
      <UnsavedChangesGuard dirty={dirty} />

      {stale && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">{t("admin.conflict.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("admin.conflict.body")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onReload}>
            {t("admin.conflict.reload")}
          </Button>
        </div>
      )}

      {SECTIONS.map((section) => {
        const sectionDefs = defs.filter((d) => d.section === section);
        if (sectionDefs.length === 0) return null;
        return (
          <SectionCard
            key={section}
            id={`settings-${section}`}
            title={t(`admin.config.settings.sections.${section}.title`)}
            description={t(`admin.config.settings.sections.${section}.description`)}
          >
            <div className="grid gap-4 sm:grid-cols-2">{sectionDefs.map(renderField)}</div>
            {section === "inventory" && (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("admin.config.settings.thresholdsNote")}
              </p>
            )}
          </SectionCard>
        );
      })}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? t("admin.config.settings.saving") : t("admin.config.settings.save")}
        </Button>
        {dirty && !saving && (
          <span className="text-sm text-muted-foreground">{t("admin.unsaved.title")}</span>
        )}
      </div>
    </form>
  );
}
