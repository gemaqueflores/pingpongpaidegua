import { compactWhitespace } from "@cbtm/shared";

export interface ParsedScoreFinal {
  setsA: number;
  setsB: number;
}

export interface ParsedScoreSet {
  set: number;
  a: number;
  b: number;
}

export interface ParsedScoreRaw {
  final: ParsedScoreFinal | null;
  sets: ParsedScoreSet[];
}

function normalizeScoreText(raw: string): string {
  return compactWhitespace(
    raw
      .replace(/[–—−]/g, "-")
      .replace(/×/g, "x"),
  );
}

function parsePairs(input: string): Array<{ a: number; b: number }> {
  const pairs: Array<{ a: number; b: number }> = [];
  const regex = /(\d{1,2})\s*(?:-|\/|x|X)\s*(\d{1,2})/g;

  for (const match of input.matchAll(regex)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      continue;
    }

    pairs.push({ a, b });
  }

  return pairs;
}

function parseFinalFromText(normalized: string): ParsedScoreFinal | null {
  for (const pair of parsePairs(normalized)) {
    if (pair.a <= 7 && pair.b <= 7) {
      return {
        setsA: pair.a,
        setsB: pair.b,
      };
    }
  }
  return null;
}

function parseSetsFromText(normalized: string): ParsedScoreSet[] {
  const segments = [...normalized.matchAll(/\(([^)]*)\)/g)].map((match) => compactWhitespace(match[1] ?? ""));
  let pairs: Array<{ a: number; b: number }> = [];

  for (const segment of segments) {
    pairs.push(...parsePairs(segment));
  }

  if (pairs.length === 0) {
    pairs = parsePairs(normalized);
  }

  const filtered = pairs.filter((pair) => Math.max(pair.a, pair.b) >= 8 || (pair.a === 0 && pair.b === 0));
  return filtered.map((pair, index) => ({
    set: index + 1,
    a: pair.a,
    b: pair.b,
  }));
}

function inferFinalFromSets(sets: ParsedScoreSet[]): ParsedScoreFinal | null {
  if (sets.length === 0) {
    return null;
  }

  let setsA = 0;
  let setsB = 0;
  for (const set of sets) {
    if (set.a > set.b) {
      setsA += 1;
    } else if (set.b > set.a) {
      setsB += 1;
    }
  }

  if (setsA === 0 && setsB === 0) {
    return null;
  }

  return { setsA, setsB };
}

export function parseScoreRaw(raw: string | null | undefined): ParsedScoreRaw | null {
  const normalized = normalizeScoreText(String(raw ?? ""));
  if (!normalized) {
    return null;
  }

  const sets = parseSetsFromText(normalized);
  let final = parseFinalFromText(normalized);

  if (!final) {
    final = inferFinalFromSets(sets);
  }

  if (!final && sets.length === 0) {
    return null;
  }

  return {
    final,
    sets,
  };
}
