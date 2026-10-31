import { describe, expect, it } from "vitest";
import {
  CRITICAL_KEY,
  LOW_KEY,
  SETTING_DEFS,
  normalizeSetting,
  orderChanges,
  settingMessage,
  settingProblem,
  thresholdProblem,
  toJsonValue,
  type SettingDef,
} from "./settingsSchema";

const def = (key: string): SettingDef => {
  const d = SETTING_DEFS.find((x) => x.key === key);
  if (!d) throw new Error(`sin definición: ${key}`);
  return d;
};
const problem = (key: string, raw: string) => {
  const d = def(key);
  return settingProblem(d, normalizeSetting(d, raw));
};

describe("definiciones", () => {
  it("cubren exactamente las 15 claves sembradas en la base, sin repetir", () => {
    expect(SETTING_DEFS.map((d) => d.key).sort()).toEqual(
      [
        "base_currency",
        "business_name",
        "contact_email",
        "contact_phone",
        "default_out_of_stock_behavior",
        "pdp_assistance_text",
        "pdp_shipping_return_text",
        "reservation_ttl_minutes",
        "social_facebook",
        "social_instagram",
        "social_tiktok",
        "social_youtube",
        "stock_critical_threshold",
        "stock_low_threshold",
        "whatsapp_orders",
      ].sort(),
    );
  });
  it("la moneda base y el tiempo de reserva son de solo lectura", () => {
    expect(def("base_currency").readOnly).toBe(true);
    expect(def("reservation_ttl_minutes").readOnly).toBe(true);
    expect(settingProblem(def("base_currency"), "")).toBeNull();
    expect(settingProblem(def("reservation_ttl_minutes"), "abc")).toBeNull();
  });
});

describe("normalizeSetting", () => {
  it("el correo se recorta y pasa a minúsculas (la base exige lower(btrim()))", () => {
    expect(normalizeSetting(def("contact_email"), "  Info@MadeInChola.COM ")).toBe(
      "info@madeinchola.com",
    );
  });
  it("el teléfono pierde espacios, guiones, puntos y paréntesis", () => {
    expect(normalizeSetting(def("whatsapp_orders"), "+591 (7123) 45-67")).toBe("+59171234567");
    expect(normalizeSetting(def("contact_phone"), " +54.11.4089.3614 ")).toBe("+541140893614");
  });
  it("los demás solo se recortan; el texto conserva sus saltos de línea internos", () => {
    expect(normalizeSetting(def("business_name"), "  Made In Chola  ")).toBe("Made In Chola");
    expect(normalizeSetting(def("pdp_assistance_text"), " hola\nmundo ")).toBe("hola\nmundo");
  });
});

describe("settingProblem: texto (≤ 4000 caracteres)", () => {
  it("4000 caracteres vale; 4001 no", () => {
    expect(problem("pdp_assistance_text", "a".repeat(4000))).toBeNull();
    expect(problem("pdp_assistance_text", "a".repeat(4001))).toBe("too_long");
  });
  it("cuenta caracteres, no unidades UTF-16 (un emoji cuenta 1)", () => {
    expect(problem("pdp_assistance_text", "😀".repeat(4000))).toBeNull();
    expect(problem("pdp_assistance_text", "😀".repeat(4001))).toBe("too_long");
  });
  it("los textos de la ficha pueden quedar vacíos (la base lo acepta)", () => {
    expect(problem("pdp_shipping_return_text", "")).toBeNull();
  });
  it("el nombre del negocio es obligatorio en la interfaz", () => {
    expect(problem("business_name", "   ")).toBe("required");
    expect(problem("business_name", "Made In Chola")).toBeNull();
  });
});

describe("settingProblem: enteros (hasta 9 dígitos)", () => {
  it.each(["0", "5", "007", "999999999"])("«%s» es válido", (v) => {
    expect(problem(LOW_KEY, v)).toBeNull();
  });
  it.each(["", "-1", "1.5", "1e3", "1234567890", "abc", "5 "])(
    "«%s» es inválido (salvo espacios finales, que se recortan)",
    (v) => {
      expect(problem(LOW_KEY, v)).toBe(v === "5 " ? null : "int");
    },
  );
});

describe("settingProblem: enlaces https", () => {
  it("acepta https y rechaza http, vacío y con espacios", () => {
    expect(problem("social_instagram", "https://www.instagram.com/madeinchola/")).toBeNull();
    expect(problem("social_instagram", "http://www.instagram.com")).toBe("url");
    expect(problem("social_instagram", "")).toBe("required");
    expect(problem("social_instagram", "https://a b.com")).toBe("url");
    expect(problem("social_instagram", "instagram.com/x")).toBe("url");
  });
  it("2048 caracteres vale; 2049 no", () => {
    expect(problem("social_tiktok", "https://" + "a".repeat(2040))).toBeNull();
    expect(problem("social_tiktok", "https://" + "a".repeat(2041))).toBe("url");
  });
});

describe("settingProblem: correo", () => {
  it("acepta un correo válido, ya normalizado a minúsculas", () => {
    expect(problem("contact_email", "Info@MadeInChola.com")).toBeNull();
  });
  it.each(["", "sin-arroba", "a@b", "a@@b.co", "a b@c.co", "a@b."])("«%s» es inválido", (v) => {
    expect(problem("contact_email", v)).not.toBeNull();
  });
  it("254 caracteres vale; 255 no", () => {
    const local = (n: number) => "a".repeat(n - "@b.co".length) + "@b.co";
    expect(problem("contact_email", local(254))).toBeNull();
    expect(problem("contact_email", local(255))).toBe("email");
  });
});

describe("settingProblem sin normalizar (el validador por sí solo imita a la base)", () => {
  it("un correo con mayúsculas o espacios SE RECHAZA tal cual (la base exige lower(btrim()))", () => {
    expect(settingProblem(def("contact_email"), "Info@MadeInChola.com")).toBe("email");
    expect(settingProblem(def("contact_email"), " info@madeinchola.com")).toBe("email");
    expect(settingProblem(def("contact_email"), "info@madeinchola.com")).toBeNull();
  });
  it("un teléfono con espacios se rechaza tal cual (la normalización es un paso aparte)", () => {
    expect(settingProblem(def("contact_phone"), "+591 71234567")).toBe("phone");
  });
});

describe("settingProblem: teléfono E.164", () => {
  it.each(["+59171234567", "+541140893614", "+12345678", "+123456789012345"])(
    "«%s» es válido",
    (v) => {
      expect(problem("whatsapp_orders", v)).toBeNull();
    },
  );
  it.each(["59171234567", "+0123456789", "+1234567", "+1234567890123456", "+59a71234567", ""])(
    "«%s» es inválido",
    (v) => {
      expect(problem("whatsapp_orders", v)).not.toBeNull();
    },
  );
  it("acepta el formato escrito con espacios y paréntesis (se normaliza antes)", () => {
    expect(problem("whatsapp_orders", "+591 7123-4567")).toBeNull();
  });
});

describe("settingProblem: comportamiento sin stock", () => {
  it("solo sold_out u hide", () => {
    expect(problem("default_out_of_stock_behavior", "sold_out")).toBeNull();
    expect(problem("default_out_of_stock_behavior", "hide")).toBeNull();
    expect(problem("default_out_of_stock_behavior", "borrar")).toBe("option");
    expect(problem("default_out_of_stock_behavior", "")).toBe("option");
  });
});

describe("thresholdProblem (crítico ≤ aviso)", () => {
  it("el crítico no puede superar al aviso; la igualdad es válida", () => {
    expect(thresholdProblem("5", "2")).toBeNull();
    expect(thresholdProblem("5", "5")).toBeNull();
    expect(thresholdProblem("5", "6")).toBe(
      "El umbral crítico (6) no puede superar al de aviso (5).",
    );
  });
  it("compara como números, no como texto ('10' > '9')", () => {
    expect(thresholdProblem("9", "10")).not.toBeNull();
    expect(thresholdProblem("10", "9")).toBeNull();
  });
  it("si alguno no es un entero válido no opina (ya lo señala su propio campo)", () => {
    expect(thresholdProblem("", "5")).toBeNull();
    expect(thresholdProblem("5", "x")).toBeNull();
  });
});

describe("toJsonValue", () => {
  it("los enteros viajan como número; el resto como texto", () => {
    expect(toJsonValue(def(LOW_KEY), "007")).toBe(7);
    expect(typeof toJsonValue(def(LOW_KEY), "5")).toBe("number");
    expect(toJsonValue(def("business_name"), "Chola")).toBe("Chola");
    expect(toJsonValue(def("contact_phone"), "+59171234567")).toBe("+59171234567");
  });
});

describe("settingMessage", () => {
  it("cada problema tiene un mensaje en español, sin claves sin traducir", () => {
    for (const p of ["required", "too_long", "int", "url", "email", "phone", "option"] as const) {
      const m = settingMessage(p);
      expect(m).not.toMatch(/^admin\./);
      expect(m.length).toBeGreaterThan(5);
    }
  });
});

describe("orderChanges: el orden de guardado de los umbrales", () => {
  // Réplica de las reglas de la base: cada umbral se valida contra el OTRO ya guardado.
  const applyInOrder = (
    start: { low: number; critical: number },
    order: { key: string; value: string }[],
  ): boolean => {
    const stored = { ...start };
    for (const c of order) {
      const v = Number(c.value);
      if (c.key === LOW_KEY) {
        if (v < stored.critical) return false;
        stored.low = v;
      } else {
        if (v > stored.low) return false;
        stored.critical = v;
      }
    }
    return true;
  };
  const both = (low: number, critical: number) => [
    { key: LOW_KEY, value: String(low) },
    { key: CRITICAL_KEY, value: String(critical) },
  ];

  it("subir ambos (5/2 → 20/6): primero el aviso, luego el crítico", () => {
    const ordered = orderChanges(both(20, 6), "5");
    expect(ordered.map((c) => c.key)).toEqual([LOW_KEY, CRITICAL_KEY]);
  });
  it("bajar ambos (5/2 → 1/1): primero el crítico, luego el aviso", () => {
    const ordered = orderChanges(both(1, 1), "5");
    expect(ordered.map((c) => c.key)).toEqual([CRITICAL_KEY, LOW_KEY]);
  });
  it("con el orden ingenuo (aviso primero) bajar ambos FALLA en la base; con orderChanges no", () => {
    expect(applyInOrder({ low: 5, critical: 2 }, both(1, 1))).toBe(false);
    expect(applyInOrder({ low: 5, critical: 2 }, orderChanges(both(1, 1), "5"))).toBe(true);
  });
  it("con el orden ingenuo (crítico primero) subir ambos FALLA; con orderChanges no", () => {
    const naive = [both(20, 6)[1], both(20, 6)[0]] as { key: string; value: string }[];
    expect(applyInOrder({ low: 5, critical: 2 }, naive)).toBe(false);
    expect(applyInOrder({ low: 5, critical: 2 }, orderChanges(both(20, 6), "5"))).toBe(true);
  });
  it("PROPIEDAD: para todo estado inicial válido y todo estado final válido, el orden elegido siempre se guarda sin error", () => {
    const states: [number, number][] = [];
    for (let low = 0; low <= 8; low++)
      for (let critical = 0; critical <= low; critical++) states.push([low, critical]);
    let checked = 0;
    for (const [oldLow, oldCritical] of states) {
      for (const [newLow, newCritical] of states) {
        if (newLow === oldLow || newCritical === oldCritical) continue; // solo cuando cambian los DOS
        const ordered = orderChanges(both(newLow, newCritical), String(oldLow));
        expect(
          applyInOrder({ low: oldLow, critical: oldCritical }, ordered),
          `${oldLow}/${oldCritical} → ${newLow}/${newCritical}`,
        ).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
  it("si cambia solo uno, o ninguno de los dos, no reordena", () => {
    const only = [{ key: LOW_KEY, value: "9" }];
    expect(orderChanges(only, "5")).toEqual(only);
    const others = [{ key: "business_name", value: "X" }];
    expect(orderChanges(others, "5")).toEqual(others);
  });
  it("conserva los demás cambios y no pierde ninguno", () => {
    const mixed = [{ key: "business_name", value: "X" }, ...both(20, 6)];
    const ordered = orderChanges(mixed, "5");
    expect(ordered).toHaveLength(3);
    expect(ordered.map((c) => c.key).sort()).toEqual(
      ["business_name", CRITICAL_KEY, LOW_KEY].sort(),
    );
  });
});
