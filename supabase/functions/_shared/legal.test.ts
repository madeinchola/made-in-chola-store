import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { HttpError } from "./errors.ts";
import {
  assertLegalAccepted,
  assertLegalSubset,
  checkLegal,
  type LegalDeps,
  legalFields,
  recordLegalAcceptance,
  sentVersions,
} from "./legal.ts";
import { z } from "https://esm.sh/zod@3.25.76";

const REQUIRED = { terms: 2, privacy: 1 };

Deno.test("sentVersions: solo lo que mandó, con los nombres de la base", () => {
  assertEquals(sentVersions({ legal_terms: 2, legal_privacy: 1 }), {
    terms: 2,
    privacy: 1,
  });
  assertEquals(sentVersions({ legal_terms: 2 }), { terms: 2 });
  assertEquals(sentVersions({}), {});
});

Deno.test("checkLegal: con las versiones exactas pasa; sobrantes no importan", () => {
  checkLegal(REQUIRED, { terms: 2, privacy: 1 });
  checkLegal(REQUIRED, { terms: 2, privacy: 1, cookies: 9 });
});

Deno.test("checkLegal: si nada exige aceptación, no se pide nada", () => {
  checkLegal({}, {});
  checkLegal({}, { terms: 5 });
});

Deno.test("checkLegal: si falta un documento, 409 legal_required con lo vigente", () => {
  const error = assertThrows(() => checkLegal(REQUIRED, { terms: 2 }), HttpError) as HttpError;
  assertEquals([error.status, error.code], [409, "legal_required"]);
  assertEquals(error.details.required, REQUIRED);
});

Deno.test("checkLegal: una versión vieja o una futura es 409 legal_outdated", () => {
  for (const sent of [
    { terms: 1, privacy: 1 },
    { terms: 3, privacy: 1 },
  ]) {
    const error = assertThrows(() => checkLegal(REQUIRED, sent), HttpError) as HttpError;
    assertEquals([error.status, error.code], [409, "legal_outdated"]);
    assertEquals(error.details.required, REQUIRED);
  }
});

Deno.test(
  "legalFields: solo enteros positivos y acotados (nada de listas ni objetos abiertos)",
  () => {
    const schema = z.object(legalFields).strict();
    assertEquals(schema.safeParse({ legal_terms: 2, legal_privacy: 1 }).success, true);
    assertEquals(schema.safeParse({}).success, true);
    for (const bad of [
      { legal_terms: 0 },
      { legal_terms: 1.5 },
      { legal_terms: "2" },
      { legal_terms: [2] },
      { legal_terms: {} },
      { legal_terms: 1e9 },
      { otro: 1 },
    ]) {
      assertEquals(schema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  },
);

const deps = (
  required: Record<string, number>,
  record: LegalDeps["record"] = () => Promise.resolve(),
): LegalDeps => ({
  required: () => Promise.resolve(required),
  record,
});

Deno.test(
  "assertLegalAccepted: devuelve lo vigente cuando coincide y rechaza cuando no",
  async () => {
    assertEquals(
      await assertLegalAccepted({ legal_terms: 2, legal_privacy: 1 }, deps(REQUIRED)),
      REQUIRED,
    );
    await assertRejects(
      () => assertLegalAccepted({ legal_terms: 2 }, deps(REQUIRED)),
      HttpError,
      "Para continuar",
    );
    assertEquals(await assertLegalAccepted({}, deps({})), {});
  },
);

Deno.test(
  "assertLegalSubset: acepta solo una parte de lo vigente y devuelve SOLO lo que mandó",
  async () => {
    assertEquals(await assertLegalSubset({ legal_terms: 2 }, deps(REQUIRED)), {
      terms: 2,
    });
    assertEquals(await assertLegalSubset({ legal_privacy: 1 }, deps(REQUIRED)), {
      privacy: 1,
    });
    assertEquals(
      await assertLegalSubset({ legal_terms: 2, legal_privacy: 1 }, deps(REQUIRED)),
      REQUIRED,
    );
  },
);

Deno.test(
  "assertLegalSubset: no mandar nada habiendo algo exigido es legal_required, con lo vigente",
  async () => {
    const error = (await assertRejects(
      () => assertLegalSubset({}, deps(REQUIRED)),
      HttpError,
    )) as HttpError;
    assertEquals(
      [error.status, error.code, error.details],
      [409, "legal_required", { required: REQUIRED }],
    );
  },
);

Deno.test(
  "assertLegalSubset: una versión que no es la vigente (vieja, futura o de un texto que no se exige) es legal_outdated",
  async () => {
    for (const fields of [
      { legal_terms: 1 },
      { legal_terms: 3 },
      {
        legal_terms: 2,
        legal_privacy: 9,
      },
    ]) {
      const error = (await assertRejects(
        () => assertLegalSubset(fields, deps(REQUIRED)),
        HttpError,
      )) as HttpError;
      assertEquals([error.status, error.code], [409, "legal_outdated"]);
    }
    // si solo se exige uno, mandar el otro tampoco vale
    const only = (await assertRejects(
      () => assertLegalSubset({ legal_privacy: 1 }, deps({ terms: 2 })),
      HttpError,
    )) as HttpError;
    assertEquals(only.code, "legal_outdated");
  },
);

Deno.test(
  "assertLegalSubset: si nada exige aceptación no se registra nada, mande lo que mande",
  async () => {
    assertEquals(await assertLegalSubset({}, deps({})), {});
    assertEquals(await assertLegalSubset({ legal_terms: 5 }, deps({})), {});
  },
);

Deno.test("recordLegalAcceptance: registra con las versiones y la IP del pedido", async () => {
  const calls: unknown[] = [];
  const req = new Request("https://x.test", {
    headers: { "cf-connecting-ip": "203.0.113.5" },
  });
  await recordLegalAcceptance(
    {
      profileId: "p1",
      orderId: null,
      context: "register",
      versions: REQUIRED,
      req,
    },
    deps(REQUIRED, (input) => {
      calls.push(input);
      return Promise.resolve();
    }),
    () => {
      throw new Error("no debía fallar");
    },
  );
  assertEquals(calls.length, 1);
  const call = calls[0] as {
    profileId: string;
    context: string;
    versions: unknown;
    ip: string;
  };
  assertEquals([call.profileId, call.context, call.versions], ["p1", "register", REQUIRED]);
});

Deno.test(
  "recordLegalAcceptance: si la base lo rechaza NO lanza (la cuenta o el pedido ya existen); avisa",
  async () => {
    let failure: unknown = null;
    const req = new Request("https://x.test");
    await recordLegalAcceptance(
      {
        profileId: "p1",
        orderId: null,
        context: "checkout",
        versions: REQUIRED,
        req,
      },
      deps(REQUIRED, () => Promise.reject(new Error("legal_outdated"))),
      (e) => {
        failure = e;
      },
    );
    assertEquals(String(failure), "Error: legal_outdated");
  },
);

Deno.test(
  "recordLegalAcceptance: sin versiones (nada exige aceptación) no llama a la base",
  async () => {
    let called = false;
    await recordLegalAcceptance(
      {
        profileId: "p1",
        orderId: null,
        context: "register",
        versions: {},
        req: new Request("https://x.test"),
      },
      deps({}, () => {
        called = true;
        return Promise.resolve();
      }),
      () => {},
    );
    assertEquals(called, false);
  },
);
