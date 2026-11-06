import { t } from "@/i18n";
import type { DistanceDraftErrors, NumberProblem, TierProblem } from "./tierLogic";
import type { AmountProblem, PriorityProblem, RateErrors } from "./RatesFormLogic";

/** Traduce los códigos de problema de la lógica pura (`tierLogic`, `RatesFormLogic`) al texto que se ve junto al campo. */
const P = "admin.shipping.rates.problems" as const;
const T = "admin.shipping.rates.tiers.errors" as const;
const F = "admin.shipping.rates.rules.form.errors" as const;

/** `bound` dice contra qué tope se pasó el valor: kilómetros (20.000) o costo (1.000.000). */
export function numberProblemText(problem: NumberProblem, bound: "km" | "cost"): string {
  switch (problem) {
    case "required":
      return t(`${P}.required`);
    case "number":
      return t(`${P}.number`);
    case "negative":
      return t(`${P}.negative`);
    case "zero":
      return t(`${P}.zero`);
    case "too_big":
      return bound === "km" ? t(`${P}.tooBigKm`) : t(`${P}.tooBigCost`);
  }
}

/** Problema del campo «hasta» de un tramo: los de un número más «debe ser mayor que el tramo anterior». */
export const tierUpToText = (problem: TierProblem): string =>
  problem === "order" ? t(`${T}.order`) : numberProblemText(problem, "km");

export const distanceListText = (problem: NonNullable<DistanceDraftErrors["list"]>): string =>
  problem === "no_tiers" ? t(`${T}.noTiers`) : t(`${T}.tooMany`);

export const amountProblemText = (problem: AmountProblem): string =>
  problem === "too_big" ? t(`${P}.tooBigAmount`) : t(`${P}.${problem}`);

export function priorityProblemText(problem: PriorityProblem): string {
  switch (problem) {
    case "required":
      return t(`${F}.priorityRequired`);
    case "number":
      return t(`${F}.priorityNumber`);
    case "integer":
      return t(`${F}.priorityInteger`);
    case "range":
      return t(`${F}.priorityRange`);
  }
}

export const nameProblemText = (problem: NonNullable<RateErrors["name"]>): string =>
  problem === "required" ? t(`${F}.nameRequired`) : t(`${F}.nameTooLong`);

export const validUntilText = (problem: NonNullable<RateErrors["validUntil"]>): string =>
  problem === "invalid" ? t(`${F}.validUntilInvalid`) : t(`${F}.validUntilBeforeFrom`);
