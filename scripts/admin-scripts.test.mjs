import { describe, expect, it } from "vitest";
import { parseArgs } from "./promote-admin.mjs";

describe("promote-admin: parseArgs", () => {
  it("normaliza el email", () => {
    expect(parseArgs([" Admin@Chola.COM "])).toEqual({ email: "admin@chola.com" });
  });
  it.each([[[]], [["no-es-email"]], [["--flag"]], [["a b@c.com"]]])("rechaza %j", (argv) => {
    expect(() => parseArgs(argv)).toThrow(/Uso:/);
  });
});
