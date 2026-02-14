import { describe, expect, it } from "vitest";
import { normalizeRegistrationScope, normalizeRegistrationStatus } from "../src/registration-status";

describe("registration status", () => {
  it("normaliza status inscrito e pre-inscrito", () => {
    expect(normalizeRegistrationStatus("Inscrito")).toBe("INSCRITO");
    expect(normalizeRegistrationStatus("Pré-inscrito")).toBe("PRE_INSCRITO");
    expect(normalizeRegistrationStatus(" pre inscrito ")).toBe("PRE_INSCRITO");
  });

  it("trata status vazio e fora do padrao", () => {
    expect(normalizeRegistrationStatus("")).toBeNull();
    expect(normalizeRegistrationStatus(null)).toBeNull();
    expect(normalizeRegistrationStatus("Aguardando")).toBe("OUTRO");
  });

  it("normaliza escopo de simulacao", () => {
    expect(normalizeRegistrationScope(undefined)).toBe("confirmed");
    expect(normalizeRegistrationScope("confirmed")).toBe("confirmed");
    expect(normalizeRegistrationScope("confirmed_and_pre")).toBe("confirmed_and_pre");
  });
});

