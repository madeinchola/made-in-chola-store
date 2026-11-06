import type { CoordinateProblem } from "@/components/map/coords";
import { t } from "@/i18n";
import type { RadiusProblem, ZoneErrors } from "./ZonesLogic";

/** Traduce los códigos de problema de `ZonesLogic` al texto que se ve junto al campo. */
const E = "admin.shipping.rates.zones.form.errors" as const;

export const zoneNameText = (problem: NonNullable<ZoneErrors["name"]>): string =>
  problem === "required" ? t(`${E}.nameRequired`) : t(`${E}.nameTooLong`);

export const zoneCitiesText = (problem: NonNullable<ZoneErrors["cities"]>): string =>
  problem === "none" ? t(`${E}.citiesNone`) : t(`${E}.citiesTooMany`);

export function radiusProblemText(problem: RadiusProblem): string {
  switch (problem) {
    case "required":
      return t(`${E}.radiusRequired`);
    case "number":
      return t(`${E}.radiusNumber`);
    case "not_positive":
      return t(`${E}.radiusNotPositive`);
    case "too_big":
      return t(`${E}.radiusTooBig`);
    case "decimals":
      return t(`${E}.radiusDecimals`);
  }
}

export function latitudeProblemText(problem: CoordinateProblem): string {
  return problem === "missing"
    ? t(`${E}.latMissing`)
    : problem === "format"
      ? t(`${E}.latFormat`)
      : t(`${E}.latRange`);
}

export function longitudeProblemText(problem: CoordinateProblem): string {
  return problem === "missing"
    ? t(`${E}.lngMissing`)
    : problem === "format"
      ? t(`${E}.lngFormat`)
      : t(`${E}.lngRange`);
}
