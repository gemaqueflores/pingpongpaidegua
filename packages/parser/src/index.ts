import { load } from "cheerio";
import he from "he";
import vm from "node:vm";
import {
  ParsedCategory,
  ParsedDataset,
  ParsedMatch,
  ParsedMatchSet,
  ParsedMatchSetsResult,
  ParsedRegistration,
  compactWhitespace,
  computeMatchKey,
  getRoundSemanticOrder,
  isDoublesLikeLabel,
  isLikelyAthleteName,
  normalizeDoublesPairName,
  normalizeText,
  parseBrazilianDateTime,
} from "@cbtm/shared";

export type DxTab = "INSCRICOES" | "GRUPOS" | "RESULTADOS" | "ELIMINATORIA" | "UNKNOWN";
const ELIMINATORIA_ENABLED = false;

export interface DxPayload {
  rawLiteral: string;
  html: string;
  categoryId: string | null;
  tab: DxTab;
  keys: string[];
  callbackState: string | null;
  cardView: {
    controlId: string | null;
    pageIndex: number | null;
    pageCount: number | null;
    pageRowCount: number | null;
    pageRowSize: number | null;
  };
}

export interface DiscoveredCategory {
  categoryId: string;
  categoryName: string;
  valid: boolean;
  registeredCount?: number | null;
  preRegisteredCount?: number | null;
  totalListedCount?: number | null;
  officialMatchesCount?: number | null;
}

export interface EliminationPayload {
  categoryId: string;
  categoryName: string;
  rawBody: string;
}

export interface ParseDxOptions {
  categoriesDiscovered?: DiscoveredCategory[];
  eliminationPayloads?: EliminationPayload[];
}

interface DxParsedObject {
  result?: {
    data?: unknown;
    parameter?: string | number | null;
    i?: Array<{ value?: string | number | null; text?: string | null }>;
    html?: string;
    stateObject?: {
      html?: string;
      keys?: string[];
      callbackState?: string;
      selection?: string | null;
    };
  };
  cp?: {
    cpCategoriaId?: string | number | null;
  };
}

export interface CategoryContext {
  categoryId: string;
  categoryName?: string | null;
  callbackState?: string | null;
  selection?: string | null;
  keys?: string[];
}

export interface DxResponseChunk {
  rawLiteral: string;
  parsed: DxParsedObject;
  categoryId: string | null;
  parameter: string | null;
  keys: string[];
  callbackState: string | null;
  selection: string | null;
  html: string | null;
}

interface AthleteHint {
  rankingPoints: number | null;
  ratingPoints: number | null;
}

interface HintCollection {
  global: Map<string, AthleteHint>;
  byCategory: Map<string, Map<string, AthleteHint>>;
}

type AthleteHintResolver = (input: {
  categoryId: string | null;
  categoryNormalizedName: string;
  athleteNormalizedName: string;
}) => AthleteHint | undefined;

interface CardViewInfo {
  controlId: string | null;
  pageIndex: number | null;
  pageCount: number | null;
  pageRowCount: number | null;
  pageRowSize: number | null;
}

const IGNORED_CATEGORY_IDS = new Set(["88888888", "99999999"]);

function detectTab(html: string): DxTab {
  if (html.includes("EventoTabPage_Inscricoes")) {
    return "INSCRICOES";
  }
  if (html.includes("EventoTabPage_Grupos")) {
    return "GRUPOS";
  }
  if (html.includes("EventoTabPage_Resultados")) {
    return "RESULTADOS";
  }
  if (html.includes("EventoTabPage_FaseEliminatoria") || html.includes("EventoTabPage_Eliminatoria")) {
    return "ELIMINATORIA";
  }
  return "UNKNOWN";
}

function isIgnoredCategoryId(categoryId: string | null | undefined): boolean {
  return Boolean(categoryId && IGNORED_CATEGORY_IDS.has(String(categoryId)));
}

function cleanCategoryDisplayName(value: string): string {
  return compactWhitespace(
    value.replace(
      /\s+\d+\s+(?:pr[eé][-\s]?inscrito(?:\(s\)|s)?|inscrito(?:\(s\)|s)?)(?:[\s\S]*)$/i,
      "",
    ),
  );
}

function isLikelyCategoryName(value: string | null | undefined): boolean {
  const cleaned = cleanCategoryDisplayName(compactWhitespace(value ?? ""));
  if (!cleaned) {
    return false;
  }

  const normalized = normalizeText(cleaned);
  if (!normalized) {
    return false;
  }

  if (/^[a-z]{2,4}$/.test(normalized)) {
    return true;
  }

  if (/\((mas|fem|misto)\)/i.test(cleaned)) {
    return true;
  }

  if (/\b(mas|fem|misto)\b/i.test(normalized)) {
    return true;
  }

  if (
    /\b(sub[-\s]?\d+|master|absoluto|veterano|infantil|mirim|pre[-\s]?mirim|juventude|juvenil|cadete|senior)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  return false;
}

function buildCategoryKey(input: { categoryId: string | null | undefined; categoryNormalizedName: string }): string {
  if (input.categoryId) {
    return `id:${input.categoryId}`;
  }
  return `name:${input.categoryNormalizedName}`;
}

function inferEliminationFromRound(round: string | null | undefined): boolean {
  return getRoundSemanticOrder(round) <= 70;
}

function normalizeRoundLabel(round: string | null | undefined): string | null {
  const clean = compactWhitespace(round ?? "");
  if (!clean) {
    return null;
  }

  const normalized = normalizeText(clean);
  if (normalized.includes("oitavas")) {
    return "Oitavas de Final";
  }
  if (normalized.includes("quartas")) {
    return "Quartas de Final";
  }
  if (normalized.includes("semi")) {
    return "Semifinal";
  }
  if (normalized.includes("final")) {
    return "Final";
  }

  return clean;
}

function extractNumberFromScript(html: string, field: string): number | null {
  const regex = new RegExp(`'${field}':(-?\\d+)`);
  const match = html.match(regex);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function extractCardViewInfo(html: string): CardViewInfo {
  const controlMatch = html.match(/Get\('([^']*CardView[^']*)'\)/);
  return {
    controlId: controlMatch?.[1] ?? null,
    pageIndex: extractNumberFromScript(html, "pageIndex"),
    pageCount: extractNumberFromScript(html, "pageCount"),
    pageRowCount: extractNumberFromScript(html, "pageRowCount"),
    pageRowSize: extractNumberFromScript(html, "pageRowSize"),
  };
}

function safeEvalDxObject(literal: string): DxParsedObject | null {
  try {
    const script = `(${literal})`;
    const result = vm.runInNewContext(script, Object.create(null), {
      timeout: 50,
      displayErrors: false,
    }) as DxParsedObject;
    return result;
  } catch {
    return null;
  }
}

function extractBalancedObject(content: string, startIndex: number): { literal: string; endIndex: number } | null {
  const start = content.indexOf("{", startIndex);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quoteChar = "";
  let escaped = false;

  for (let i = start; i < content.length; i += 1) {
    const ch = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          literal: content.slice(start, i + 1),
          endIndex: i + 1,
        };
      }
    }
  }

  return null;
}

function normalizeCategoryId(value: unknown): string | null {
  const normalized = compactWhitespace(String(value ?? ""));
  return /^\d+$/.test(normalized) ? normalized : null;
}

function inferCategoryIdFromKeys(keys: string[]): string | null {
  for (const key of keys) {
    const normalized = compactWhitespace(String(key ?? ""));
    if (!normalized) {
      continue;
    }

    const prefixed = normalized.match(/^(\d{2,})\|/);
    if (prefixed?.[1]) {
      return prefixed[1];
    }

    if (/^\d{2,}$/.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

function resolveCategoryId(parsed: DxParsedObject, fallbackCategoryId: string | null): string | null {
  const stateObject = parsed.result?.stateObject;
  const keys = stateObject?.keys ?? [];
  return (
    normalizeCategoryId(parsed.cp?.cpCategoriaId) ??
    normalizeCategoryId(parsed.result?.parameter) ??
    inferCategoryIdFromKeys(keys) ??
    fallbackCategoryId
  );
}

function extractDxResponseChunks(rawText: string): DxResponseChunk[] {
  const marker = "/*DX*/(";
  const chunks: DxResponseChunk[] = [];
  let cursor = 0;
  let lastCategoryId: string | null = null;

  while (cursor < rawText.length) {
    const markerIndex = rawText.indexOf(marker, cursor);
    if (markerIndex < 0) {
      break;
    }

    const balanced = extractBalancedObject(rawText, markerIndex + marker.length);
    if (!balanced) {
      break;
    }

    cursor = balanced.endIndex;

    const parsed = safeEvalDxObject(balanced.literal);
    if (!parsed) {
      continue;
    }

    const stateObject = parsed.result?.stateObject;
    const categoryId = resolveCategoryId(parsed, lastCategoryId);
    if (categoryId) {
      lastCategoryId = categoryId;
    }

    const htmlRaw = parsed.result?.html ?? stateObject?.html ?? null;
    const html = htmlRaw ? he.decode(htmlRaw) : null;

    chunks.push({
      rawLiteral: balanced.literal,
      parsed,
      categoryId,
      parameter: normalizeCategoryId(parsed.result?.parameter),
      keys: stateObject?.keys ?? [],
      callbackState: stateObject?.callbackState ?? null,
      selection: stateObject?.selection ?? null,
      html,
    });
  }

  return chunks;
}

export class DXResponseParser {
  extractChunks(rawText: string): DxResponseChunk[] {
    return extractDxResponseChunks(rawText);
  }

  extractPayloads(rawText: string): DxPayload[] {
    const payloads: DxPayload[] = [];

    for (const chunk of this.extractChunks(rawText)) {
      if (!chunk.html || !chunk.html.trim()) {
        continue;
      }

      payloads.push({
        rawLiteral: chunk.rawLiteral,
        html: chunk.html,
        categoryId: chunk.categoryId,
        tab: detectTab(chunk.html),
        keys: chunk.keys,
        callbackState: chunk.callbackState,
        cardView: extractCardViewInfo(chunk.html),
      });
    }

    return payloads;
  }
}

export function extractDxPayloads(rawText: string): DxPayload[] {
  return new DXResponseParser().extractPayloads(rawText);
}

interface CardSnapshot {
  lines: string[];
  html: string;
}

function buildCardLinesFromText(rawText: string): string[] {
  return rawText
    .split(/\r?\n/g)
    .map((line) => compactWhitespace(line))
    .filter(Boolean)
    .filter((line) => !/^\/\//.test(line))
    .filter((line) => !/^<!--/.test(line))
    .filter((line) => !line.includes("ASPx.createControl"));
}

function toCardSnapshots(html: string, selector: string): CardSnapshot[] {
  const $ = load(html);
  const cards: CardSnapshot[] = [];

  $(selector).each((_, el) => {
    const lines = buildCardLinesFromText($(el).text());
    if (lines.length === 0) {
      return;
    }

    cards.push({
      lines,
      html: $.html(el),
    });
  });

  return cards;
}

function toTextLines(html: string, selector: string): string[][] {
  return toCardSnapshots(html, selector).map((card) => card.lines);
}

function parseLooseInteger(input: string | null | undefined): number | null {
  const digits = compactWhitespace(input ?? "").replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildHintCategoryKeys(
  categoryId: string | null | undefined,
  categoryNormalizedName: string | null | undefined,
): string[] {
  const keys: string[] = [];
  const normalizedId = normalizeCategoryId(categoryId);
  const normalizedName = normalizeText(categoryNormalizedName ?? "");

  if (normalizedId) {
    keys.push(`id:${normalizedId}`);
  }
  if (normalizedName) {
    keys.push(`name:${normalizedName}`);
  }

  return keys;
}

function createHintCollection(): HintCollection {
  return {
    global: new Map<string, AthleteHint>(),
    byCategory: new Map<string, Map<string, AthleteHint>>(),
  };
}

function getOrCreateCategoryHintMap(
  collection: HintCollection,
  categoryKey: string,
): Map<string, AthleteHint> {
  const existing = collection.byCategory.get(categoryKey);
  if (existing) {
    return existing;
  }

  const created = new Map<string, AthleteHint>();
  collection.byCategory.set(categoryKey, created);
  return created;
}

function getCategoryNameFromPayloadHtml(html: string): string | null {
  const cards = toTextLines(html, ".dxcvBreakpointsCard_MaterialCompact");
  for (const lines of cards) {
    const title = compactWhitespace(lines[0] ?? "");
    if (!title || !title.includes(" - ")) {
      continue;
    }
    const categoryName = cleanCategoryDisplayName(compactWhitespace(title.split(" - ")[0] ?? ""));
    if (isLikelyCategoryName(categoryName)) {
      return cleanCategoryDisplayName(categoryName);
    }
  }

  for (const lines of cards) {
    for (const line of lines) {
      const candidate = cleanCategoryDisplayName(compactWhitespace(line));
      if (isLikelyCategoryName(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function extractPoints(lines: string[], type: "ranking" | "rating"): number | null {
  const pattern =
    type === "ranking"
      ? /([\d.,]+)\s*pts\.?\s*ranking/i
      : /([\d.,]+)\s*pts\.?\s*rating/i;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      return parseLooseInteger(match[1]);
    }
  }

  return null;
}

function parseRegistrations(
  html: string,
  categoryId: string | null,
  fallbackCategoryName?: string | null,
  forcedCategoryName?: string | null,
): ParsedRegistration[] {
  const cards = toTextLines(html, ".dxcvBreakpointsCard_MaterialCompact");
  const registrations: ParsedRegistration[] = [];

  for (const lines of cards) {
    if (lines.length < 4) {
      continue;
    }

    const athleteName = normalizeDoublesPairName(compactWhitespace(lines[0]));
    const clubNameRaw = compactWhitespace(lines[1]);
    const clubName = clubNameRaw || "SEM CLUBE";
    const inlineCategoryName = cleanCategoryDisplayName(compactWhitespace(lines[2] ?? ""));
    const fallbackCategory = isLikelyCategoryName(fallbackCategoryName)
      ? cleanCategoryDisplayName(compactWhitespace(fallbackCategoryName ?? ""))
      : "";
    const categoryName = forcedCategoryName || inlineCategoryName || fallbackCategory;
    const statusLine =
      lines.find((line) => /\bpre[-\s]?inscrito\b/i.test(line) || /\binscrito\b/i.test(line)) ??
      lines[3] ??
      "";
    const status = compactWhitespace(statusLine);
    const rankingPoints = extractPoints(lines, "ranking");
    const ratingPoints = extractPoints(lines, "rating");

    if (!athleteName || !categoryName) {
      continue;
    }

    registrations.push({
      categoryId,
      athleteName,
      athleteNormalizedName: normalizeText(athleteName),
      clubName,
      clubNormalizedName: normalizeText(clubName),
      categoryName,
      categoryNormalizedName: normalizeText(categoryName),
      status,
      rankingPoints,
      ratingPoints,
    });
  }

  return registrations;
}

function buildRegistrationDedupKey(registration: ParsedRegistration): string {
  const categoryIdentity = registration.categoryId
    ? `id:${registration.categoryId}`
    : `name:${registration.categoryNormalizedName}`;
  return `${registration.athleteNormalizedName}|${registration.clubNormalizedName}|${categoryIdentity}`;
}

function parseGroupAthleteHints(html: string): Map<string, AthleteHint> {
  const cards = toTextLines(html, ".dxcvBreakpointsCard_MaterialCompact");
  const hints = new Map<string, AthleteHint>();

  for (const lines of cards) {
    const headerIndex = lines.findIndex((line) => /pt\.\s*rat/i.test(line));
    if (headerIndex < 0) {
      continue;
    }

    let i = headerIndex + 1;
    while (i + 3 < lines.length) {
      const pos = lines[i];
      const name = lines[i + 1];
      const rankingRaw = lines[i + 2];
      const ratingRaw = lines[i + 3];
      const ranking = parseLooseInteger(rankingRaw);
      const rating = parseLooseInteger(ratingRaw);

      if (!parseLooseInteger(pos) || !isLikelyAthleteName(name) || ranking === null || rating === null) {
        i += 1;
        continue;
      }

      hints.set(normalizeText(name), {
        rankingPoints: ranking,
        ratingPoints: rating,
      });

      i += 4;
      if (i < lines.length && parseLooseInteger(lines[i]) === null) {
        i += 1;
      }
    }
  }

  return hints;
}

function addUniqueHint(
  map: Map<string, AthleteHint>,
  blocked: Set<string>,
  key: string,
  hint: AthleteHint,
): void {
  if (!key || blocked.has(key)) {
    return;
  }

  if (hint.rankingPoints === null && hint.ratingPoints === null) {
    return;
  }

  const previous = map.get(key);
  if (!previous) {
    map.set(key, hint);
    return;
  }

  const sameValues =
    previous.rankingPoints === hint.rankingPoints &&
    previous.ratingPoints === hint.ratingPoints;

  if (!sameValues) {
    map.delete(key);
    blocked.add(key);
  }
}

function buildRegistrationHints(registrations: ParsedRegistration[]): HintCollection {
  const hints = createHintCollection();
  const blockedGlobal = new Set<string>();
  const blockedByCategory = new Map<string, Set<string>>();

  for (const registration of registrations) {
    const full = registration.athleteNormalizedName;
    const tokens = full.split(" ").filter(Boolean);
    const firstLast = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : full;
    const hint = {
      rankingPoints: registration.rankingPoints,
      ratingPoints: registration.ratingPoints,
    };

    addUniqueHint(hints.global, blockedGlobal, full, hint);
    addUniqueHint(hints.global, blockedGlobal, firstLast, hint);

    const categoryKeys = buildHintCategoryKeys(
      registration.categoryId ?? null,
      registration.categoryNormalizedName,
    );
    for (const categoryKey of categoryKeys) {
      const categoryMap = getOrCreateCategoryHintMap(hints, categoryKey);
      const categoryBlocked =
        blockedByCategory.get(categoryKey) ?? new Set<string>();
      blockedByCategory.set(categoryKey, categoryBlocked);
      addUniqueHint(categoryMap, categoryBlocked, full, hint);
      addUniqueHint(categoryMap, categoryBlocked, firstLast, hint);
    }
  }

  return hints;
}

function extractMatchMeta(line: string): { roundToken: string | null; tableNumber: string | null; time: string | null } {
  const table = line.match(/mesa\s*(\d+)/i)?.[1] ?? null;
  const time = line.match(/(\d{1,2}:\d{2})/)?.[1] ?? null;
  const game = line.match(/jogo\s*0*(\d+)/i)?.[1] ?? null;
  return {
    roundToken: game,
    tableNumber: table,
    time,
  };
}

function parseFinalSetsResult(scoreRaw: string | null | undefined): ParsedMatchSetsResult | null {
  const normalized = compactWhitespace(scoreRaw ?? "");
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+)\s*[-xX]\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const p1Sets = Number(match[1]);
  const p2Sets = Number(match[2]);
  if (!Number.isFinite(p1Sets) || !Number.isFinite(p2Sets)) {
    return null;
  }

  return {
    p1Sets,
    p2Sets,
  };
}

function extractNumericTokens(lines: string[], start: number, end: number): number[] {
  const values: number[] = [];
  for (let i = start; i < end; i += 1) {
    const line = compactWhitespace(lines[i] ?? "");
    if (!/^\d+$/.test(line)) {
      continue;
    }
    values.push(Number(line));
  }
  return values;
}

function parseSetScoresFromCardLines(
  lines: string[],
  athleteAName: string,
  athleteBName: string,
): { sets: ParsedMatchSet[]; setsResultFromTokens: ParsedMatchSetsResult | null } {
  const normalizedAthleteA = normalizeText(athleteAName);
  const normalizedAthleteB = normalizeText(athleteBName);

  const firstNameIndex = lines.findIndex((line) => normalizeText(line) === normalizedAthleteA);
  const secondNameIndex = lines.findIndex((line, idx) => idx > firstNameIndex && normalizeText(line) === normalizedAthleteB);

  if (firstNameIndex < 0 || secondNameIndex < 0 || secondNameIndex <= firstNameIndex) {
    return {
      sets: [],
      setsResultFromTokens: null,
    };
  }

  const p1Tokens = extractNumericTokens(lines, firstNameIndex + 1, secondNameIndex);
  const p2Tokens = extractNumericTokens(lines, secondNameIndex + 1, lines.length);

  const p1Sets = p1Tokens.length > 0 ? p1Tokens[0] : null;
  const p2Sets = p2Tokens.length > 0 ? p2Tokens[0] : null;
  const p1PerSet = p1Tokens.slice(1);
  const p2PerSet = p2Tokens.slice(1);

  const sets: ParsedMatchSet[] = [];
  const setCount = Math.max(p1PerSet.length, p2PerSet.length);
  for (let i = 0; i < setCount; i += 1) {
    const p1 = p1PerSet[i];
    const p2 = p2PerSet[i];
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
      continue;
    }
    sets.push({
      p1: Number(p1),
      p2: Number(p2),
    });
  }

  const setsResultFromTokens =
    Number.isFinite(p1Sets) && Number.isFinite(p2Sets)
      ? { p1Sets: Number(p1Sets), p2Sets: Number(p2Sets) }
      : null;

  return {
    sets,
    setsResultFromTokens,
  };
}

function parseNumericCardCellValue(input: string): number | null {
  const normalized = compactWhitespace(input.replace(/\u00A0/g, " "));
  if (!normalized) {
    return null;
  }
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function composeDoublesPairName(left: string, right: string): string {
  return normalizeDoublesPairName(`${left} - ${right}`);
}

function parseSetScoresFromCardHtml(cardHtml: string, isDoubles = false): {
  athleteAName: string;
  athleteBName: string;
  sets: ParsedMatchSet[];
  setsResultFromTokens: ParsedMatchSetsResult | null;
} | null {
  const $ = load(cardHtml);
  const players: Array<{ name: string; scores: Array<number | null> }> = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) {
      return;
    }

    const name = compactWhitespace($(cells[0]).text().replace(/\u00A0/g, " "));
    if (!name || !isLikelyAthleteName(name)) {
      return;
    }

    const scores: Array<number | null> = [];
    for (let index = 1; index < cells.length; index += 1) {
      scores.push(parseNumericCardCellValue($(cells[index]).text()));
    }

    if (!isDoubles && scores.every((value) => value === null)) {
      return;
    }

    players.push({ name, scores });
  });

  if (players.length < 2) {
    return null;
  }

  const athleteA = players[0];
  const athleteB = isDoubles && players.length >= 4 ? players[2] : players[1];
  const p1Sets = athleteA.scores[0];
  const p2Sets = athleteB.scores[0];
  const p1PerSet = athleteA.scores.slice(1);
  const p2PerSet = athleteB.scores.slice(1);

  let lastSetWithData = -1;
  const candidateSetCount = Math.max(p1PerSet.length, p2PerSet.length);
  for (let index = 0; index < candidateSetCount; index += 1) {
    if (Number.isFinite(p1PerSet[index]) || Number.isFinite(p2PerSet[index])) {
      lastSetWithData = index;
    }
  }

  const sets: ParsedMatchSet[] = [];
  for (let index = 0; index <= lastSetWithData; index += 1) {
    const p1 = p1PerSet[index];
    const p2 = p2PerSet[index];
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
      continue;
    }
    sets.push({
      p1: Number(p1),
      p2: Number(p2),
    });
  }

  const setsResultFromTokens =
    Number.isFinite(p1Sets) && Number.isFinite(p2Sets)
      ? { p1Sets: Number(p1Sets), p2Sets: Number(p2Sets) }
      : null;

  return {
    athleteAName:
      isDoubles && players.length >= 4 ? composeDoublesPairName(players[0].name, players[1].name) : athleteA.name,
    athleteBName:
      isDoubles && players.length >= 4 ? composeDoublesPairName(players[2].name, players[3].name) : athleteB.name,
    sets,
    setsResultFromTokens,
  };
}

function isBracketReferenceToken(value: string): boolean {
  const normalized = compactWhitespace(value ?? "");
  if (!normalized) {
    return false;
  }

  if (/^\d{1,2}\s*-\s*\d{1,2}$/.test(normalized)) {
    return true;
  }

  if (/^[vVwW]\s*\d{1,3}$/.test(normalized)) {
    return true;
  }

  return false;
}

function parseParticipantRefType(value: string): "REAL" | "GROUP_SLOT" | "WINNER_SLOT" {
  const normalized = compactWhitespace(value ?? "");
  if (!normalized) {
    return "REAL";
  }
  if (/^[vVwW]\s*\d{1,3}$/.test(normalized)) {
    return "WINNER_SLOT";
  }
  if (/^\d{1,2}\s*-\s*\d{1,2}$/.test(normalized)) {
    return "GROUP_SLOT";
  }
  return "REAL";
}

function isCardMetaLine(value: string): boolean {
  const line = compactWhitespace(value ?? "");
  if (!line) {
    return false;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) {
    return true;
  }

  if (/jogo\s*\d+/i.test(line)) {
    return true;
  }

  return false;
}

function inferWinnerIndexFromSets(input: {
  setsResult: ParsedMatchSetsResult | null;
  sets: ParsedMatchSet[];
}): 0 | 1 | null {
  if (input.setsResult) {
    if (input.setsResult.p1Sets > input.setsResult.p2Sets) {
      return 0;
    }
    if (input.setsResult.p2Sets > input.setsResult.p1Sets) {
      return 1;
    }
  }

  let p1Wins = 0;
  let p2Wins = 0;
  for (const set of input.sets) {
    if (set.p1 > set.p2) {
      p1Wins += 1;
    } else if (set.p2 > set.p1) {
      p2Wins += 1;
    }
  }

  if (p1Wins > p2Wins) {
    return 0;
  }
  if (p2Wins > p1Wins) {
    return 1;
  }

  return null;
}

function parseCardBasedMatches(
  eventId: number,
  html: string,
  categoryId: string | null,
  phase: "RESULTADOS" | "ELIMINATORIA",
  athleteHintResolver: AthleteHintResolver,
): ParsedMatch[] {
  const cards = toCardSnapshots(html, ".dxcvBreakpointsCard_MaterialCompact");
  const matches: ParsedMatch[] = [];

  for (const card of cards) {
    const lines = card.lines;
    if (lines.length < 4) {
      continue;
    }

    const title = lines[0] ?? "";
    const metaLine = lines.find((line) => /jogo\s*\d+/i.test(line)) ?? "";
    const dateLine = lines.find((line) => /^\d{2}\/\d{2}\/\d{4}$/.test(line)) ?? "";
    const categoryName = cleanCategoryDisplayName(compactWhitespace(title.split(" - ")[0] ?? ""));
    const isDoubles = isDoublesLikeLabel(categoryName);
    const cardScoreData = parseSetScoresFromCardHtml(card.html, isDoubles);
    const roundRaw = title.includes(" - ") ? compactWhitespace(title.split(" - ").slice(1).join(" - ")) : null;
    const round = normalizeRoundLabel(roundRaw);
    const resolvedPhase = phase;

    const filteredNames = lines.filter((line, idx) => {
      if (idx === 0) {
        return false;
      }
      if (isCardMetaLine(line)) {
        return false;
      }
      if (line.includes(" - ")) {
        return false;
      }
      return isLikelyAthleteName(line);
    });

    const bracketReferenceCandidates = lines.filter((line, idx) => {
      if (idx === 0) {
        return false;
      }
      if (isCardMetaLine(line)) {
        return false;
      }
      return isBracketReferenceToken(line);
    });

    const athleteANameRaw =
      cardScoreData?.athleteAName ??
      (isDoubles && filteredNames.length >= 4
        ? composeDoublesPairName(filteredNames[0], filteredNames[1])
        : filteredNames[0]) ??
      bracketReferenceCandidates[0];
    const athleteBNameRaw =
      cardScoreData?.athleteBName ??
      (isDoubles && filteredNames.length >= 4
        ? composeDoublesPairName(filteredNames[2], filteredNames[3])
        : filteredNames[1]) ??
      bracketReferenceCandidates[1];
    if (!athleteANameRaw || !athleteBNameRaw || !categoryName) {
      continue;
    }

    const athleteAName = normalizeDoublesPairName(compactWhitespace(athleteANameRaw));
    const athleteBName = normalizeDoublesPairName(compactWhitespace(athleteBNameRaw));
    const athleteARefType = parseParticipantRefType(athleteAName);
    const athleteBRefType = parseParticipantRefType(athleteBName);
    const athleteANameNormalized = normalizeText(athleteAName);
    const athleteBNameNormalized = normalizeText(athleteBName);
    const scoreRaw =
      lines.find((line) => {
        if (!/^\d+\s*-\s*\d+$/.test(line)) {
          return false;
        }
        const normalizedLine = normalizeText(line);
        if (normalizedLine === athleteANameNormalized || normalizedLine === athleteBNameNormalized) {
          return false;
        }
        return true;
      }) ?? "";
    const meta = extractMatchMeta(metaLine);
    const fallbackSetScores = parseSetScoresFromCardLines(lines, athleteAName, athleteBName);
    const setScores =
      cardScoreData &&
      ((cardScoreData.sets?.length ?? 0) > 0 || cardScoreData.setsResultFromTokens)
        ? cardScoreData
        : fallbackSetScores;
    const scoreFromHeader = parseFinalSetsResult(scoreRaw);
    const setsResult = scoreFromHeader ?? setScores.setsResultFromTokens;
    const winnerIndex = inferWinnerIndexFromSets({
      setsResult,
      sets: setScores.sets,
    });

    const matchDatetime = parseBrazilianDateTime(dateLine || null, meta.time);
    const categoryNormalizedName = normalizeText(categoryName);
    const athleteANormalizedName = athleteANameNormalized;
    const athleteBNormalizedName = athleteBNameNormalized;

    const athleteAHint = athleteHintResolver({
      categoryId,
      categoryNormalizedName,
      athleteNormalizedName: athleteANormalizedName,
    });
    const athleteBHint = athleteHintResolver({
      categoryId,
      categoryNormalizedName,
      athleteNormalizedName: athleteBNormalizedName,
    });

    const matchKey = computeMatchKey({
      eventId,
      categoryNormalized: categoryNormalizedName,
      phase: resolvedPhase,
      round,
      tableNumber: meta.tableNumber,
      matchDatetime,
      athleteA: athleteANormalizedName,
      athleteB: athleteBNormalizedName,
    });

    matches.push({
      categoryId,
      phase: resolvedPhase,
      categoryName,
      categoryNormalizedName,
      round,
      tableNumber: meta.tableNumber,
      matchDatetime,
      scoreRaw,
      athleteAName,
      athleteARefType,
      athleteANormalizedName,
      athleteBName,
      athleteBRefType,
      athleteBNormalizedName,
      athleteARankingPoints: athleteAHint?.rankingPoints ?? null,
      athleteARatingPoints: athleteAHint?.ratingPoints ?? null,
      athleteBRankingPoints: athleteBHint?.rankingPoints ?? null,
      athleteBRatingPoints: athleteBHint?.ratingPoints ?? null,
      matchKey,
      sets: setScores.sets,
      setsResult,
      winnerIndex,
      sourceUrl: `https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=${eventId}`,
      metadata: {
        rawMeta: metaLine,
        rawDate: dateLine,
        jogo: meta.roundToken,
      },
    });
  }

  return matches;
}

function parseGroupMatches(
  eventId: number,
  html: string,
  categoryId: string | null,
  athleteHintResolver: AthleteHintResolver,
): { matches: ParsedMatch[]; warnings: string[] } {
  const cards = toTextLines(html, ".dxcvBreakpointsCard_MaterialCompact");
  const matches: ParsedMatch[] = [];
  const warnings: string[] = [];

  for (const lines of cards) {
    const title = lines.find((line) => /grupo\s*\d+/i.test(line)) ?? lines[0] ?? "";
    const normalizedTitle = normalizeText(title);
    if (
      normalizedTitle.includes("os grupos nao estao disponiveis") ||
      normalizedTitle.includes("grupos nao estao disponiveis")
    ) {
      // Sentinela de indisponibilidade do site oficial: nao representa categoria real.
      continue;
    }
    const categoryName = compactWhitespace(title.split(" - ")[0] ?? "");
    const roundRaw = title.includes(" - ") ? compactWhitespace(title.split(" - ").slice(1).join(" - ")) : "Grupo";
    const round = normalizeRoundLabel(roundRaw) ?? "Grupo";

    const players = lines.filter((line) => isLikelyAthleteName(line) && !line.includes(" - ") && !/classificado/i.test(line));
    const uniquePlayers = [...new Set(players)].slice(0, 8);
    const scoreTokens = lines.filter((line) => /^\d+\s*[xX]\s*\d+$/.test(line));

    if (uniquePlayers.length < 2) {
      warnings.push(`Grupos sem matriz completa para '${title}'.`);
      continue;
    }

    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < uniquePlayers.length; i += 1) {
      for (let j = i + 1; j < uniquePlayers.length; j += 1) {
        pairs.push([uniquePlayers[i], uniquePlayers[j]]);
      }
    }

    if (scoreTokens.length === 0) {
      // Grupos já divulgados, mas sem confrontos publicados na matriz ainda.
      continue;
    }

    if (scoreTokens.length < pairs.length) {
      warnings.push(
        `Grupos com matriz parcial para '${title}' (${scoreTokens.length}/${pairs.length} confrontos).`,
      );
    }

    const limit = Math.min(scoreTokens.length, pairs.length);
    for (let i = 0; i < limit; i += 1) {
      const athleteAName = normalizeDoublesPairName(pairs[i][0]);
      const athleteBName = normalizeDoublesPairName(pairs[i][1]);
      const scoreRaw = compactWhitespace(scoreTokens[i]);

      const athleteANormalizedName = normalizeText(athleteAName);
      const athleteBNormalizedName = normalizeText(athleteBName);
      const athleteARefType = parseParticipantRefType(athleteAName);
      const athleteBRefType = parseParticipantRefType(athleteBName);
      const categoryNormalizedName = normalizeText(categoryName);

      const athleteAHint = athleteHintResolver({
        categoryId,
        categoryNormalizedName,
        athleteNormalizedName: athleteANormalizedName,
      });
      const athleteBHint = athleteHintResolver({
        categoryId,
        categoryNormalizedName,
        athleteNormalizedName: athleteBNormalizedName,
      });
      const setsResult = parseFinalSetsResult(scoreRaw);
      const winnerIndex = inferWinnerIndexFromSets({
        setsResult,
        sets: [],
      });

      matches.push({
        categoryId,
        phase: "GRUPOS",
        categoryName,
        categoryNormalizedName,
        round,
        tableNumber: null,
        matchDatetime: null,
        scoreRaw,
        athleteAName,
        athleteARefType,
        athleteANormalizedName,
        athleteBName,
        athleteBRefType,
        athleteBNormalizedName,
        athleteARankingPoints: athleteAHint?.rankingPoints ?? null,
        athleteARatingPoints: athleteAHint?.ratingPoints ?? null,
        athleteBRankingPoints: athleteBHint?.rankingPoints ?? null,
        athleteBRatingPoints: athleteBHint?.ratingPoints ?? null,
        matchKey: computeMatchKey({
          eventId,
          categoryNormalized: categoryNormalizedName,
          phase: "GRUPOS",
          round,
          tableNumber: null,
          matchDatetime: null,
          athleteA: athleteANormalizedName,
          athleteB: athleteBNormalizedName,
        }),
        sets: [],
        setsResult,
        winnerIndex,
        sourceUrl: `https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID=${eventId}`,
        metadata: {
          source: "group-matrix-heuristic",
        },
      });
    }
  }

  return { matches, warnings };
}

function parseEliminationRawBody(rawBody: string): {
  teams: string[][];
  results: Array<Array<[number | null, number | null, string | null]>>;
} | null {
  try {
    const first = JSON.parse(rawBody) as unknown;
    const parsed = typeof first === "string" ? (JSON.parse(first) as unknown) : first;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const teamsRaw = (parsed as { teams?: unknown }).teams;
    const resultsRaw = (parsed as { results?: unknown }).results;
    if (!Array.isArray(teamsRaw) || !Array.isArray(resultsRaw)) {
      return null;
    }

    const teams = teamsRaw
      .filter((item): item is unknown[] => Array.isArray(item))
      .map((pair) => [compactWhitespace(String(pair[0] ?? "")), compactWhitespace(String(pair[1] ?? ""))]);

    const results: Array<Array<[number | null, number | null, string | null]>> = resultsRaw
      .filter((round): round is unknown[] => Array.isArray(round))
      .map((round) =>
        round
          .filter((match): match is unknown[] => Array.isArray(match))
          .map((match) => {
            const scoreA = Number.isFinite(Number(match[0])) ? Number(match[0]) : null;
            const scoreB = Number.isFinite(Number(match[1])) ? Number(match[1]) : null;
            const meta = compactWhitespace(String(match[2] ?? "")) || null;
            return [scoreA, scoreB, meta];
          }),
      );

    return { teams, results };
  } catch {
    return null;
  }
}

function roundLabelBySize(size: number, index: number): string {
  if (size <= 1) {
    return "Final";
  }
  if (size === 2) {
    return "Semifinal";
  }
  if (size === 4) {
    return "Quartas de Final";
  }
  if (size === 8) {
    return "Oitavas de Final";
  }
  return `Rodada ${index + 1}`;
}

function parseEliminationMeta(meta: string | null): {
  tableNumber: string | null;
  matchDatetime: string | null;
} {
  const clean = compactWhitespace(meta ?? "");
  const dateMatch = clean.match(/(\d{2}\/\d{2}\/\d{4})/);
  const timeMatch = clean.match(/(\d{1,2}:\d{2})/);
  const tableMatch = clean.match(/mesa\s*(\d+)/i);

  return {
    tableNumber: tableMatch?.[1] ?? null,
    matchDatetime: parseBrazilianDateTime(dateMatch?.[1] ?? null, timeMatch?.[1] ?? null),
  };
}

function parseEliminationMatches(
  eventId: number,
  payload: EliminationPayload,
  athleteHintResolver: AthleteHintResolver,
): ParsedMatch[] {
  const parsed = parseEliminationRawBody(payload.rawBody);
  if (!parsed) {
    return [];
  }

  const categoryName = cleanCategoryDisplayName(payload.categoryName);
  const categoryNormalizedName = normalizeText(categoryName);
  if (!categoryName) {
    return [];
  }

  const matches: ParsedMatch[] = [];
  let currentPairs = parsed.teams.map(
    (pair) =>
      [normalizeDoublesPairName(compactWhitespace(pair[0])), normalizeDoublesPairName(compactWhitespace(pair[1]))] as [
        string,
        string,
      ],
  );

  for (let roundIndex = 0; roundIndex < parsed.results.length; roundIndex += 1) {
    const roundResults = parsed.results[roundIndex];
    if (!Array.isArray(roundResults) || roundResults.length === 0) {
      continue;
    }

    const roundLabel = roundLabelBySize(roundResults.length, roundIndex);
    const winners: string[] = [];

    for (let matchIndex = 0; matchIndex < roundResults.length; matchIndex += 1) {
      const [scoreA, scoreB, meta] = roundResults[matchIndex];
      const pair = currentPairs[matchIndex] ?? ["", ""];
      const athleteAName = normalizeDoublesPairName(compactWhitespace(pair[0]));
      const athleteBName = normalizeDoublesPairName(compactWhitespace(pair[1]));

      if (!athleteAName || !athleteBName) {
        winners.push("");
        continue;
      }

      const athleteANormalizedName = normalizeText(athleteAName);
      const athleteBNormalizedName = normalizeText(athleteBName);
      const athleteARefType = parseParticipantRefType(athleteAName);
      const athleteBRefType = parseParticipantRefType(athleteBName);
      const athleteAHint = athleteHintResolver({
        categoryId: payload.categoryId,
        categoryNormalizedName,
        athleteNormalizedName: athleteANormalizedName,
      });
      const athleteBHint = athleteHintResolver({
        categoryId: payload.categoryId,
        categoryNormalizedName,
        athleteNormalizedName: athleteBNormalizedName,
      });
      const metaData = parseEliminationMeta(meta);
      const hasScore = scoreA !== null && scoreB !== null;
      const setsResult = hasScore ? { p1Sets: Number(scoreA), p2Sets: Number(scoreB) } : null;
      const winnerIndex = inferWinnerIndexFromSets({
        setsResult,
        sets: [],
      });

      const scoreRaw =
        hasScore ? `${scoreA}-${scoreB}` : compactWhitespace(meta ?? "");

      matches.push({
        categoryId: payload.categoryId,
        phase: "ELIMINATORIA",
        categoryName,
        categoryNormalizedName,
        round: roundLabel,
        tableNumber: metaData.tableNumber,
        matchDatetime: metaData.matchDatetime,
        scoreRaw,
        athleteAName,
        athleteARefType,
        athleteANormalizedName,
        athleteBName,
        athleteBRefType,
        athleteBNormalizedName,
        athleteARankingPoints: athleteAHint?.rankingPoints ?? null,
        athleteARatingPoints: athleteAHint?.ratingPoints ?? null,
        athleteBRankingPoints: athleteBHint?.rankingPoints ?? null,
        athleteBRatingPoints: athleteBHint?.ratingPoints ?? null,
        sets: [],
        setsResult,
        winnerIndex,
        matchKey: computeMatchKey({
          eventId,
          categoryNormalized: categoryNormalizedName,
          phase: "ELIMINATORIA",
          round: roundLabel,
          tableNumber: metaData.tableNumber,
          matchDatetime: metaData.matchDatetime,
          athleteA: athleteANormalizedName,
          athleteB: athleteBNormalizedName,
        }),
        sourceUrl: `https://app.cbtm.org.br/api/GameResult/${eventId}/${payload.categoryId}`,
        metadata: {
          source: "api-game-result",
          rawMeta: meta,
        },
      });

      if (hasScore && scoreA !== scoreB) {
        winners.push(scoreA > scoreB ? athleteAName : athleteBName);
      } else {
        winners.push("");
      }
    }

    const nextPairs: Array<[string, string]> = [];
    for (let i = 0; i < winners.length; i += 2) {
      nextPairs.push([
        normalizeDoublesPairName(compactWhitespace(winners[i] ?? "")),
        normalizeDoublesPairName(compactWhitespace(winners[i + 1] ?? "")),
      ]);
    }
    currentPairs = nextPairs;
  }

  return matches;
}

function scoreRawDetailWeight(scoreRaw: string): number {
  const normalized = compactWhitespace(scoreRaw);
  if (!normalized) {
    return 0;
  }

  const pairs = [...normalized.matchAll(/(\d{1,2})\s*[-xX/]\s*(\d{1,2})/g)].length;
  const hasParentheses = normalized.includes("(") && normalized.includes(")");

  let score = Math.min(normalized.length, 120);
  if (pairs > 1) {
    score += 120 + pairs * 10;
  }
  if (hasParentheses) {
    score += 30;
  }

  return score;
}

function phasePreference(phase: ParsedMatch["phase"]): number {
  if (phase === "RESULTADOS") {
    return 40;
  }
  if (phase === "ELIMINATORIA") {
    return 35;
  }
  if (phase === "GRUPOS") {
    return 20;
  }
  return 10;
}

function buildScopedParserDedupKey(match: ParsedMatch): string {
  const categoryScope = match.categoryId
    ? `cat:id:${String(match.categoryId).trim()}`
    : `cat:name:${normalizeText(match.categoryNormalizedName) || "desconhecida"}`;
  return `${categoryScope}|${String(match.matchKey ?? "").trim()}`;
}

function getMatchDedupWeight(match: ParsedMatch): number {
  const setsCount = match.sets?.length ?? 0;
  const hasSetsResult = Boolean(match.setsResult);
  const hasDatetime = Boolean(match.matchDatetime);
  const hasTable = Boolean(match.tableNumber);

  return (
    setsCount * 1000 +
    (hasSetsResult ? 300 : 0) +
    (hasDatetime ? 40 : 0) +
    (hasTable ? 20 : 0) +
    phasePreference(match.phase) +
    scoreRawDetailWeight(match.scoreRaw)
  );
}

function choosePreferredDedupMatch(current: ParsedMatch, incoming: ParsedMatch): ParsedMatch {
  const currentWeight = getMatchDedupWeight(current);
  const incomingWeight = getMatchDedupWeight(incoming);

  if (incomingWeight > currentWeight) {
    return incoming;
  }
  if (currentWeight > incomingWeight) {
    return current;
  }

  const incomingSource = compactWhitespace(incoming.sourceUrl ?? "");
  const currentSource = compactWhitespace(current.sourceUrl ?? "");
  if (incomingSource && !currentSource) {
    return incoming;
  }
  if (currentSource && !incomingSource) {
    return current;
  }

  return current;
}

export function parseDxPayloads(
  eventId: number,
  payloads: DxPayload[],
  options: ParseDxOptions = {},
): ParsedDataset {
  const registrations: ParsedRegistration[] = [];
  const matches: ParsedMatch[] = [];
  const warnings: string[] = [];
  const categories = new Map<string, ParsedCategory>();
  const categoryIdsFromPayload = new Set<string>();
  const categoryNamesFromData = new Set<string>();

  const tabPayloadCounts: Record<string, number> = {
    INSCRICOES: 0,
    GRUPOS: 0,
    RESULTADOS: 0,
    ELIMINATORIA: 0,
    UNKNOWN: 0,
  };
  const tabItemCounts: Record<string, number> = {
    INSCRICOES: 0,
    GRUPOS: 0,
    RESULTADOS: 0,
    ELIMINATORIA: 0,
  };
  const categoryTabPayloadCounts: Record<string, Record<string, number>> = {};
  const registrationsByCategory: Record<string, number> = {};
  const matchesByCategoryPhase: Record<string, Record<string, number>> = {};

  const discoveredCategoryNameById = new Map<string, string>();
  const unknownPayloadCategoryIds = new Map<string, number>();
  const groupHints = createHintCollection();
  const groupBlockedGlobal = new Set<string>();
  const groupBlockedByCategory = new Map<string, Set<string>>();
  const discoveredCategories = options.categoriesDiscovered ?? [];
  const hasDiscoveredCategories = discoveredCategories.length > 0;

  const sanitizePayloadCategoryId = (categoryId: string | null | undefined, tab: DxTab): string | null => {
    if (!categoryId) {
      return null;
    }
    if (!hasDiscoveredCategories) {
      return categoryId;
    }
    if (discoveredCategoryNameById.has(categoryId)) {
      return categoryId;
    }
    const key = `${tab}:${categoryId}`;
    unknownPayloadCategoryIds.set(key, (unknownPayloadCategoryIds.get(key) ?? 0) + 1);
    return null;
  };

  const upsertCategory = (input: ParsedCategory) => {
    if (!input.categoryNormalizedName || !input.valid) {
      return;
    }

    const key = buildCategoryKey({
      categoryId: input.categoryId,
      categoryNormalizedName: input.categoryNormalizedName,
    });
    const previous = categories.get(key);
    if (!previous) {
      categories.set(key, input);
      return;
    }

    if (input.source === "SCRAPER" && previous.source !== "SCRAPER") {
      categories.set(key, input);
    }
  };

  for (const discovered of discoveredCategories) {
    const categoryName = cleanCategoryDisplayName(discovered.categoryName);
    discoveredCategoryNameById.set(discovered.categoryId, categoryName);
    const categoryNormalizedName = normalizeText(categoryName);
    upsertCategory({
      categoryId: discovered.categoryId,
      categoryName,
      categoryNormalizedName,
      valid: discovered.valid && !isIgnoredCategoryId(discovered.categoryId),
      source: "SCRAPER",
    });
  }

  for (const payload of payloads) {
    const payloadCategoryId = sanitizePayloadCategoryId(payload.categoryId, payload.tab);
    tabPayloadCounts[payload.tab] = (tabPayloadCounts[payload.tab] ?? 0) + 1;
    const categoryBucket = payloadCategoryId ? payloadCategoryId : "sem_categoria";
    categoryTabPayloadCounts[categoryBucket] = categoryTabPayloadCounts[categoryBucket] ?? {};
    categoryTabPayloadCounts[categoryBucket][payload.tab] =
      (categoryTabPayloadCounts[categoryBucket][payload.tab] ?? 0) + 1;

    if (payloadCategoryId) {
      categoryIdsFromPayload.add(payloadCategoryId);
    }

    if (isIgnoredCategoryId(payloadCategoryId)) {
      continue;
    }

    if (payload.tab === "INSCRICOES") {
      const payloadCategoryName =
        discoveredCategoryNameById.get(payloadCategoryId ?? "") ??
        getCategoryNameFromPayloadHtml(payload.html) ??
        null;
      const forcedCategoryName = payloadCategoryId && payloadCategoryName ? payloadCategoryName : null;
      const parsed = parseRegistrations(
        payload.html,
        payloadCategoryId,
        payloadCategoryName,
        forcedCategoryName,
      );
      registrations.push(...parsed);
      tabItemCounts.INSCRICOES += parsed.length;
      continue;
    }

    if (payload.tab === "GRUPOS") {
      const parsedGroupHints = parseGroupAthleteHints(payload.html);
      const payloadCategoryName =
        discoveredCategoryNameById.get(payloadCategoryId ?? "") ??
        getCategoryNameFromPayloadHtml(payload.html) ??
        "";
      const payloadCategoryKeys = buildHintCategoryKeys(
        payloadCategoryId,
        normalizeText(payloadCategoryName),
      );

      for (const [athleteKey, hint] of parsedGroupHints.entries()) {
        addUniqueHint(groupHints.global, groupBlockedGlobal, athleteKey, hint);

        for (const categoryKey of payloadCategoryKeys) {
          const categoryMap = getOrCreateCategoryHintMap(groupHints, categoryKey);
          const categoryBlocked =
            groupBlockedByCategory.get(categoryKey) ?? new Set<string>();
          groupBlockedByCategory.set(categoryKey, categoryBlocked);
          addUniqueHint(categoryMap, categoryBlocked, athleteKey, hint);
        }
      }
    }
  }

  const registrationHints = buildRegistrationHints(registrations);
  const athleteHintResolver: AthleteHintResolver = ({
    categoryId,
    categoryNormalizedName,
    athleteNormalizedName,
  }) => {
    const categoryKeys = buildHintCategoryKeys(
      categoryId,
      categoryNormalizedName,
    );

    for (const categoryKey of categoryKeys) {
      const byCategory = registrationHints.byCategory.get(categoryKey);
      const hint = byCategory?.get(athleteNormalizedName);
      if (hint) {
        return hint;
      }
    }

    const registrationGlobal = registrationHints.global.get(athleteNormalizedName);
    if (registrationGlobal) {
      return registrationGlobal;
    }

    for (const categoryKey of categoryKeys) {
      const byCategory = groupHints.byCategory.get(categoryKey);
      const hint = byCategory?.get(athleteNormalizedName);
      if (hint) {
        return hint;
      }
    }

    return groupHints.global.get(athleteNormalizedName);
  };

  for (const payload of payloads) {
    const payloadCategoryId = sanitizePayloadCategoryId(payload.categoryId, payload.tab);
    if (isIgnoredCategoryId(payloadCategoryId)) {
      continue;
    }

    if (payload.tab === "RESULTADOS") {
      const parsed = parseCardBasedMatches(
        eventId,
        payload.html,
        payloadCategoryId,
        "RESULTADOS",
        athleteHintResolver,
      );
      matches.push(...parsed);
      tabItemCounts.RESULTADOS += parsed.length;
      continue;
    }

    if (payload.tab === "ELIMINATORIA") {
      if (ELIMINATORIA_ENABLED) {
        const parsed = parseCardBasedMatches(
          eventId,
          payload.html,
          payloadCategoryId,
          "ELIMINATORIA",
          athleteHintResolver,
        );
        matches.push(...parsed);
        tabItemCounts.ELIMINATORIA += parsed.length;
      } else {
        warnings.push(
          `Payload de ELIMINATORIA ignorado para categoryId=${payloadCategoryId ?? "desconhecido"} (hard-disabled).`,
        );
      }
      continue;
    }

    if (payload.tab === "GRUPOS") {
      const grouped = parseGroupMatches(
        eventId,
        payload.html,
        payloadCategoryId,
        athleteHintResolver,
      );
      matches.push(...grouped.matches);
      tabItemCounts.GRUPOS += grouped.matches.length;
      warnings.push(...grouped.warnings);
    }
  }

  if (unknownPayloadCategoryIds.size > 0) {
    const samples = [...unknownPayloadCategoryIds.entries()]
      .slice(0, 5)
      .map(([key, count]) => `${key} (${count}x)`)
      .join(", ");
    warnings.push(
      `Payload(s) com categoryId fora da lista descoberta foram normalizados para fallback por nome (${unknownPayloadCategoryIds.size} combinacao(oes)): ${samples}.`,
    );
  }

  if (ELIMINATORIA_ENABLED) {
    for (const eliminationPayload of options.eliminationPayloads ?? []) {
      if (isIgnoredCategoryId(eliminationPayload.categoryId)) {
        continue;
      }
      const parsed = parseEliminationMatches(
        eventId,
        eliminationPayload,
        athleteHintResolver,
      );
      matches.push(...parsed);
      tabItemCounts.ELIMINATORIA += parsed.length;
    }
  } else if ((options.eliminationPayloads?.length ?? 0) > 0) {
    warnings.push(
      `Payloads auxiliares de ELIMINATORIA ignorados (${options.eliminationPayloads?.length ?? 0}) por politica oficial.`,
    );
  }

  const dedupRegistrationsMap = new Map<string, ParsedRegistration>();
  for (const registration of registrations) {
    const key = buildRegistrationDedupKey(registration);
    dedupRegistrationsMap.set(key, registration);
  }

  const dedupMatchesMap = new Map<string, ParsedMatch>();
  let dedupMatchCollisions = 0;
  let dedupMatchReplacements = 0;
  for (const match of matches) {
    const dedupKey = buildScopedParserDedupKey(match);
    const current = dedupMatchesMap.get(dedupKey);
    if (!current) {
      dedupMatchesMap.set(dedupKey, match);
      continue;
    }

    dedupMatchCollisions += 1;
    const preferred = choosePreferredDedupMatch(current, match);
    if (preferred !== current) {
      dedupMatchReplacements += 1;
    }
    dedupMatchesMap.set(dedupKey, preferred);
  }

  if (dedupMatchCollisions > 0) {
    warnings.push(
      `Deduplicacao de parser consolidou ${dedupMatchCollisions} colisoes de match_key (substituicoes por registro mais rico: ${dedupMatchReplacements}).`,
    );
  }

  for (const registration of dedupRegistrationsMap.values()) {
    categoryNamesFromData.add(registration.categoryNormalizedName);
    upsertCategory({
      categoryId: registration.categoryId ?? null,
      categoryName: registration.categoryName,
      categoryNormalizedName: registration.categoryNormalizedName,
      valid: !isIgnoredCategoryId(registration.categoryId),
      source: "INSCRICOES",
    });

    const categoryLabel = registration.categoryId
      ? `${registration.categoryName} [${registration.categoryId}]`
      : registration.categoryName;
    registrationsByCategory[categoryLabel] = (registrationsByCategory[categoryLabel] ?? 0) + 1;
  }

  for (const match of dedupMatchesMap.values()) {
    categoryNamesFromData.add(match.categoryNormalizedName);
    upsertCategory({
      categoryId: match.categoryId ?? null,
      categoryName: match.categoryName,
      categoryNormalizedName: match.categoryNormalizedName,
      valid: !isIgnoredCategoryId(match.categoryId),
      source: "MATCHES",
    });

    const categoryLabel = match.categoryId ? `${match.categoryName} [${match.categoryId}]` : match.categoryName;
    matchesByCategoryPhase[categoryLabel] = matchesByCategoryPhase[categoryLabel] ?? {};
    matchesByCategoryPhase[categoryLabel][match.phase] =
      (matchesByCategoryPhase[categoryLabel][match.phase] ?? 0) + 1;
  }

  const uniqueAthletesConsolidated = new Set(
    [...dedupRegistrationsMap.values()].map(
      (item) => `${item.athleteNormalizedName}|${item.clubNormalizedName}`,
    ),
  ).size;

  const totalCategoriesFoundFromDiscovery = discoveredCategories.length;
  const totalCategoriesValidFromDiscovery = discoveredCategories.filter(
    (item) => item.valid && !isIgnoredCategoryId(item.categoryId),
  ).length;

  const fallbackFoundCategoriesCount =
    categoryIdsFromPayload.size > 0 ? categoryIdsFromPayload.size : categoryNamesFromData.size;
  const fallbackValidCategoriesCount =
    categoryIdsFromPayload.size > 0
      ? [...categoryIdsFromPayload].filter((categoryId) => !isIgnoredCategoryId(categoryId)).length
      : categoryNamesFromData.size;

  const totalCategoriesFound =
    totalCategoriesFoundFromDiscovery > 0 ? totalCategoriesFoundFromDiscovery : fallbackFoundCategoriesCount;
  const totalCategoriesValid =
    totalCategoriesFoundFromDiscovery > 0 ? totalCategoriesValidFromDiscovery : fallbackValidCategoriesCount;

  return {
    categories: [...categories.values()].sort((a, b) =>
      a.categoryName.localeCompare(b.categoryName, "pt-BR", { sensitivity: "base" }),
    ),
    registrations: [...dedupRegistrationsMap.values()],
    matches: [...dedupMatchesMap.values()],
    warnings,
    extractionStats: {
      totalCategoriesFound,
      totalCategoriesValid,
      categoriesScanned: totalCategoriesValid,
      tabPayloadCounts,
      tabItemCounts,
      categoryTabPayloadCounts,
      registrationsByCategory,
      matchesByCategoryPhase,
      uniqueAthletesConsolidated,
    },
  };
}
export function parseResultsText(eventId: number, rawText: string): ParsedDataset {
  const payloads = extractDxPayloads(rawText);
  return parseDxPayloads(eventId, payloads);
}

export const __testables = {
  parseGroupMatches,
};
