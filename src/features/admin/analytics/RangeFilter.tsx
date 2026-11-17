import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, rangeProblem } from "./logic";
import type { DateRange, RangePreset } from "./types";

interface RangeFilterProps {
  preset: RangePreset;
  range: DateRange;
  onPreset: (preset: Exclude<RangePreset, "custom">) => void;
  onCustom: (range: DateRange) => void;
}

/** Los períodos de siempre (hoy, 7 o 30 días, este mes o el pasado) y uno a medida. Todo en hora de La Paz. */
export function RangeFilter({ preset, range, onPreset, onCustom }: RangeFilterProps) {
  const [custom, setCustom] = useState(preset === "custom");
  const [draft, setDraft] = useState<DateRange>(range);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDraft(range);
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply() {
    const found = rangeProblem(draft);
    if (found) {
      setProblem(t(`admin.analytics.dashboard.range.problems.${found}`));
      return;
    }
    setProblem(null);
    onCustom(draft);
  }

  const L = "admin.analytics.dashboard.range" as const;
  return (
    <div className="mb-6 space-y-3">
      <div role="group" aria-label={t(`${L}.label`)} className="flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={preset === p ? "default" : "outline"}
            aria-pressed={preset === p}
            onClick={() => {
              setCustom(false);
              setProblem(null);
              onPreset(p);
            }}
          >
            {t(`${L}.presets.${p}`)}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={preset === "custom" || custom ? "default" : "outline"}
          aria-pressed={preset === "custom"}
          aria-expanded={custom}
          onClick={() => setCustom((open) => !open)}
        >
          {t(`${L}.presets.custom`)}
        </Button>
      </div>
      {custom && (
        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t(`${L}.from`)}</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              aria-invalid={problem !== null}
              className={cn(
                "h-10 rounded-md border border-input bg-background px-3 text-base sm:text-sm",
                problem && "border-destructive",
              )}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t(`${L}.to`)}</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              aria-invalid={problem !== null}
              className={cn(
                "h-10 rounded-md border border-input bg-background px-3 text-base sm:text-sm",
                problem && "border-destructive",
              )}
            />
          </label>
          <Button type="submit" size="sm">
            {t(`${L}.apply`)}
          </Button>
          {problem && (
            <p role="alert" className="basis-full text-sm text-destructive">
              {problem}
            </p>
          )}
        </form>
      )}
      <p className="text-xs text-muted-foreground">{t(`${L}.zone`)}</p>
    </div>
  );
}
