import { compactWhitespace, normalizeText } from "@cbtm/shared";
import type { ParsedCategory, ParsedDataset, ParsedMatch, ParsedRegistration } from "@cbtm/shared";

function isMixedDoublesEvent(eventName: string | null | undefined): boolean {
  const normalized = normalizeText(eventName).replace(/\s+/g, " ").trim();
  return /\bdupla(?:s)? mista(?:s)?\b/.test(normalized);
}

function canonicalizeMixedDoublesCategoryName(categoryName: string | null | undefined): string {
  const display = compactWhitespace(categoryName);
  if (!display) {
    return "";
  }

  const normalized = normalizeText(display).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return display;
  }

  const absoluteMatch = normalized.match(
    /^(?:dupla mista[\s-]+)?absoluto\s+([a-z0-9]+)(?:[\s-]+dupla mista)?$/i,
  );
  if (absoluteMatch) {
    return `DUPLA MISTA-ABSOLUTO ${String(absoluteMatch[1] ?? "").toUpperCase()}`;
  }

  const subMatch = normalized.match(/^sub[-\s]?(\d+)\s+dupla mista$/i);
  if (subMatch) {
    return `SUB-${String(subMatch[1] ?? "").padStart(2, "0")} DUPLA MISTA`;
  }

  const masterMatch = normalized.match(/^master[-\s]?(\d+)\s+dupla mista$/i);
  if (masterMatch) {
    return `MASTER ${String(masterMatch[1] ?? "")} DUPLA MISTA`;
  }

  return display;
}

export function canonicalizeEventScopedCategoryName(
  eventName: string | null | undefined,
  categoryName: string | null | undefined,
): string {
  const display = compactWhitespace(categoryName);
  if (!display) {
    return "";
  }

  if (!isMixedDoublesEvent(eventName)) {
    return display;
  }

  return canonicalizeMixedDoublesCategoryName(display);
}

function applyCategoryName<T extends { categoryName: string; categoryNormalizedName: string }>(
  eventName: string | null | undefined,
  row: T,
): T {
  const categoryName = canonicalizeEventScopedCategoryName(eventName, row.categoryName);
  return {
    ...row,
    categoryName,
    categoryNormalizedName: normalizeText(categoryName),
  };
}

export function canonicalizeDatasetCategoryNames(
  eventName: string | null | undefined,
  dataset: ParsedDataset,
): ParsedDataset {
  if (!isMixedDoublesEvent(eventName)) {
    return dataset;
  }

  const categories: ParsedCategory[] = dataset.categories.map((category) => applyCategoryName(eventName, category));
  const registrations: ParsedRegistration[] = dataset.registrations.map((registration) =>
    applyCategoryName(eventName, registration),
  );
  const matches: ParsedMatch[] = dataset.matches.map((match) => applyCategoryName(eventName, match));

  return {
    ...dataset,
    categories,
    registrations,
    matches,
  };
}
