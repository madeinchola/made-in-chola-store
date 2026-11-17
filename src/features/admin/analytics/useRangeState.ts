import { useSearchParams } from "react-router-dom";
import { isRangePreset, laPazToday, presetRange, rangeProblem } from "./logic";
import type { DateRange, RangePreset } from "./types";

/** El período elegido vive en la dirección (`?p=30d`, `?p=custom&desde=…&hasta=…`): se puede recargar, copiar y volver atrás. */
export function useRangeState() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("p");
  const preset: RangePreset = isRangePreset(raw) ? raw : "30d";
  const range: DateRange =
    preset === "custom"
      ? { from: params.get("desde") ?? "", to: params.get("hasta") ?? "" }
      : presetRange(preset, laPazToday());
  const problem = preset === "custom" ? rangeProblem(range) : null;
  return {
    preset,
    range,
    problem,
    setPreset: (next: Exclude<RangePreset, "custom">) => {
      const copy = new URLSearchParams(params);
      copy.set("p", next);
      copy.delete("desde");
      copy.delete("hasta");
      setParams(copy, { replace: true });
    },
    setCustom: (next: DateRange) => {
      const copy = new URLSearchParams(params);
      copy.set("p", "custom");
      copy.set("desde", next.from);
      copy.set("hasta", next.to);
      setParams(copy, { replace: true });
    },
  };
}
