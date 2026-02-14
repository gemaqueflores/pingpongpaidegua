export type RegistrationScope = "confirmed" | "confirmed_and_pre";
export type NormalizedRegistrationStatus = "INSCRITO" | "PRE_INSCRITO" | "OUTRO";

function normalizeValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRegistrationScope(raw: string | null | undefined): RegistrationScope {
  const value = normalizeValue(raw ?? "");
  if (value === "confirmed_and_pre") {
    return "confirmed_and_pre";
  }
  return "confirmed";
}

export function normalizeRegistrationStatus(
  rawStatus: string | null | undefined,
): NormalizedRegistrationStatus | null {
  const normalized = normalizeValue(rawStatus ?? "");
  if (!normalized) {
    return null;
  }

  if (normalized.includes("pre inscrito") || normalized.includes("pre-inscrito")) {
    return "PRE_INSCRITO";
  }

  if (normalized.includes("inscrito")) {
    return "INSCRITO";
  }

  return "OUTRO";
}
