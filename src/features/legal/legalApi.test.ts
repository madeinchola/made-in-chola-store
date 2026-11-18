import { describe, expect, it } from "vitest";
import { sameRequired, toAccepted } from "./legalApi";

describe("sameRequired · la aceptación vale solo para las versiones que se vieron", () => {
  it("iguales: valen; cualquier cambio en CUALQUIERA de los dos textos, no", () => {
    expect(sameRequired({ terms: 3, privacy: 2 }, { terms: 3, privacy: 2 })).toBe(true);
    expect(sameRequired({ terms: 3, privacy: 2 }, { terms: 4, privacy: 2 })).toBe(false);
    expect(sameRequired({ terms: 3, privacy: 2 }, { terms: 3, privacy: 3 })).toBe(false);
    expect(sameRequired({ terms: 3 }, { terms: 3, privacy: 1 })).toBe(false);
    expect(sameRequired({ terms: 3, privacy: 2 }, { terms: 3 })).toBe(false);
    expect(sameRequired({}, {})).toBe(true);
  });
});

describe("toAccepted · lo que viaja al servidor", () => {
  it("manda cada versión con el nombre que entiende el servidor, y solo las que se exigen", () => {
    expect(toAccepted({ terms: 3, privacy: 2 })).toEqual({ legal_terms: 3, legal_privacy: 2 });
    expect(toAccepted({ terms: 3 })).toEqual({ legal_terms: 3 });
    expect(toAccepted({ privacy: 2 })).toEqual({ legal_privacy: 2 });
    expect(toAccepted({})).toEqual({});
  });
});
