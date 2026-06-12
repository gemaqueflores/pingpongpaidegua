export type ReadModelPublishDecision = "published_n1" | "kept_n" | "merged" | "replace";
export type ReadModelPublishMode = "compare" | "replace";

export type ReadModelMeta = {
  publishedAt?: string;
  building?: boolean;
  publishDecision?: ReadModelPublishDecision;
};

type JsonObject = Record<string, unknown>;

export type MirrorPublishResult<T extends JsonObject> = {
  payload: T & { _meta?: ReadModelMeta };
  decision: ReadModelPublishDecision;
  changed: boolean;
};

type SchedulePlayer = {
  id: number | null;
  name: string;
  clubName?: string | null;
};

type ScheduleMatch = JsonObject & {
  id?: number;
  matchKey?: string;
  round?: string | null;
  tableNumber?: string | null;
  matchDatetime?: string | null;
  scoreRaw?: string | null;
  playerA?: SchedulePlayer | null;
  playerB?: SchedulePlayer | null;
  preservedFromPublishedAt?: string;
};

type ScheduleCategory = JsonObject & {
  categoryId: number;
  categoryName: string;
  matches: ScheduleMatch[];
};

type SchedulePayload = JsonObject & {
  categories?: ScheduleCategory[];
};

const ATHLETE_REGRESSION_MIN_BASE = 100;
const ATHLETE_REGRESSION_RATIO = 0.7;
const CATEGORY_REGRESSION_MIN_BASE = 30;
const CATEGORY_REGRESSION_RATIO = 0.75;
const MATCH_REGRESSION_MIN_BASE = 200;
const MATCH_REGRESSION_RATIO = 0.55;

export function isResolvedSchedulePlayer(player: SchedulePlayer | null | undefined): boolean {
  if (!player) {
    return false;
  }
  if (player.id !== null && typeof player.id === "number") {
    return true;
  }
  const normalizedName = normalizeMirrorText(player.name).toUpperCase();
  return !/^V\d+(?:$|\s|-)/.test(normalizedName) && !normalizedName.startsWith("VENCEDOR ");
}

export function publishReadModelPayload<T extends JsonObject>(input: {
  kind: string;
  current: T | null;
  candidate: T;
  mode?: ReadModelPublishMode;
  now?: Date;
}): MirrorPublishResult<T> {
  const mode = input.mode ?? "compare";
  const nowIso = (input.now ?? new Date()).toISOString();
  const currentMeta = readMeta(input.current);

  if (mode === "replace" || !input.current) {
    return {
      payload: withPublishMeta(input.candidate, nowIso, mode === "replace" ? "replace" : "published_n1"),
      decision: mode === "replace" ? "replace" : "published_n1",
      changed: true,
    };
  }

  if (input.kind === "event-schedule") {
    const merged = mergeSchedulePayload(input.current as SchedulePayload, input.candidate as SchedulePayload, currentMeta.publishedAt);
    if (merged.changed) {
      return {
        payload: withPublishMeta(merged.payload as T, nowIso, "merged"),
        decision: "merged",
        changed: true,
      };
    }
    return {
      payload: withPublishMeta(input.candidate, nowIso, "published_n1"),
      decision: "published_n1",
      changed: true,
    };
  }

  if (hasAllOrNothingRegression(input.kind, input.current, input.candidate)) {
    return {
      payload: withPublishMeta(input.current, currentMeta.publishedAt ?? nowIso, "kept_n"),
      decision: "kept_n",
      changed: false,
    };
  }

  return {
    payload: withPublishMeta(input.candidate, nowIso, "published_n1"),
    decision: "published_n1",
    changed: true,
  };
}

function withPublishMeta<T extends JsonObject>(
  payload: T,
  publishedAt: string,
  decision: ReadModelPublishDecision,
): T & { _meta?: ReadModelMeta } {
  const existing = readMeta(payload);
  return {
    ...payload,
    publishedAt,
    _meta: {
      ...existing,
      building: undefined,
      publishedAt,
      publishDecision: decision,
    },
  };
}

function readMeta(payload: JsonObject | null | undefined): ReadModelMeta {
  const meta = payload?._meta;
  return isObject(meta) ? (meta as ReadModelMeta) : {};
}

function hasAllOrNothingRegression(kind: string, current: JsonObject, candidate: JsonObject): boolean {
  if (kind === "event-athletes") {
    return dropsBelowThreshold(readCount(current, "items"), readCount(candidate, "items"), ATHLETE_REGRESSION_MIN_BASE, ATHLETE_REGRESSION_RATIO);
  }
  if (kind === "event-categories") {
    return dropsBelowThreshold(readCount(current, "items"), readCount(candidate, "items"), CATEGORY_REGRESSION_MIN_BASE, CATEGORY_REGRESSION_RATIO);
  }
  if (kind === "event-clubs") {
    return dropsBelowThreshold(readNestedCount(current, "clubs"), readNestedCount(candidate, "clubs"), ATHLETE_REGRESSION_MIN_BASE, ATHLETE_REGRESSION_RATIO);
  }
  if (kind === "event-summary") {
    return (
      dropsBelowThreshold(readNumeric(current.totalInscritos), readNumeric(candidate.totalInscritos), ATHLETE_REGRESSION_MIN_BASE, ATHLETE_REGRESSION_RATIO) ||
      dropsBelowThreshold(readNumeric(current.totalCategorias), readNumeric(candidate.totalCategorias), CATEGORY_REGRESSION_MIN_BASE, CATEGORY_REGRESSION_RATIO) ||
      dropsBelowThreshold(
        readNumeric(current.totalPartidasPublicadas ?? current.totalPartidas),
        readNumeric(candidate.totalPartidasPublicadas ?? candidate.totalPartidas),
        MATCH_REGRESSION_MIN_BASE,
        MATCH_REGRESSION_RATIO,
      )
    );
  }
  if (kind === "event-efficiency") {
    return dropsBelowThreshold(readCount(current, "ranking"), readCount(candidate, "ranking"), ATHLETE_REGRESSION_MIN_BASE, ATHLETE_REGRESSION_RATIO);
  }
  if (kind === "event-medalists") {
    return (
      dropsBelowThreshold(readCount(current, "categories"), readCount(candidate, "categories"), CATEGORY_REGRESSION_MIN_BASE, CATEGORY_REGRESSION_RATIO) ||
      dropsBelowThreshold(
        readNestedCount(current, "categories", "medalists"),
        readNestedCount(candidate, "categories", "medalists"),
        ATHLETE_REGRESSION_MIN_BASE,
        ATHLETE_REGRESSION_RATIO,
      )
    );
  }
  return false;
}

function mergeSchedulePayload(
  current: SchedulePayload,
  candidate: SchedulePayload,
  currentPublishedAt: string | undefined,
): { payload: SchedulePayload; changed: boolean } {
  const currentByCategory = indexCategories(current.categories ?? []);
  const nextCategories: ScheduleCategory[] = [];
  let changed = false;

  for (const candidateCategory of candidate.categories ?? []) {
    const currentCategory = currentByCategory.get(candidateCategory.categoryId);
    if (!currentCategory) {
      nextCategories.push(candidateCategory);
      continue;
    }
    const mergedMatches = mergeScheduleMatches(currentCategory.matches ?? [], candidateCategory.matches ?? [], currentPublishedAt);
    if (mergedMatches.changed) {
      changed = true;
    }
    nextCategories.push({
      ...candidateCategory,
      matches: mergedMatches.matches,
    });
    currentByCategory.delete(candidateCategory.categoryId);
  }

  for (const preservedCategory of currentByCategory.values()) {
    changed = true;
    nextCategories.push({
      ...preservedCategory,
      matches: (preservedCategory.matches ?? []).map((match) => markPreserved(match, currentPublishedAt)),
    });
  }

  return {
    payload: {
      ...candidate,
      categories: nextCategories,
    },
    changed,
  };
}

function mergeScheduleMatches(
  currentMatches: ScheduleMatch[],
  candidateMatches: ScheduleMatch[],
  currentPublishedAt: string | undefined,
): { matches: ScheduleMatch[]; changed: boolean } {
  const currentByKey = new Map(currentMatches.map((match) => [scheduleMatchKey(match), match]));
  const matches: ScheduleMatch[] = [];
  let changed = false;

  for (const candidate of candidateMatches) {
    const key = scheduleMatchKey(candidate);
    const current = currentByKey.get(key);
    if (!current) {
      matches.push(candidate);
      continue;
    }
    const merged = chooseBestScheduleMatch(current, candidate, currentPublishedAt);
    if (merged !== candidate) {
      changed = true;
    }
    matches.push(merged);
    currentByKey.delete(key);
  }

  for (const missing of currentByKey.values()) {
    changed = true;
    matches.push(markPreserved(missing, currentPublishedAt));
  }

  return { matches, changed };
}

function chooseBestScheduleMatch(
  current: ScheduleMatch,
  candidate: ScheduleMatch,
  currentPublishedAt: string | undefined,
): ScheduleMatch {
  const currentHasScore = hasScore(current);
  const candidateHasScore = hasScore(candidate);
  const currentPlayersResolved = isResolvedSchedulePlayer(current.playerA) && isResolvedSchedulePlayer(current.playerB);
  const candidatePlayersResolved = isResolvedSchedulePlayer(candidate.playerA) && isResolvedSchedulePlayer(candidate.playerB);

  if ((currentHasScore && !candidateHasScore) || (currentPlayersResolved && !candidatePlayersResolved)) {
    return markPreserved(current, currentPublishedAt);
  }
  return candidate;
}

function markPreserved(match: ScheduleMatch, publishedAt: string | undefined): ScheduleMatch {
  return {
    ...match,
    preservedFromPublishedAt: publishedAt,
  };
}

function scheduleMatchKey(match: ScheduleMatch): string {
  if (typeof match.matchKey === "string" && match.matchKey.trim()) {
    return match.matchKey;
  }
  return [
    match.id ?? "",
    match.round ?? "",
    match.tableNumber ?? "",
    match.matchDatetime ?? "",
    match.playerA?.name ?? "",
    match.playerB?.name ?? "",
  ].join("|");
}

function indexCategories(categories: ScheduleCategory[]): Map<number, ScheduleCategory> {
  return new Map(categories.map((category) => [category.categoryId, category]));
}

function hasScore(match: ScheduleMatch): boolean {
  return typeof match.scoreRaw === "string" && match.scoreRaw.trim().length > 0;
}

function readCount(payload: JsonObject, key: string): number {
  const value = payload[key];
  return Array.isArray(value) ? value.length : 0;
}

function readNestedCount(payload: JsonObject, key: string, nestedKey = "athletes"): number {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return 0;
  }
  return value.reduce((total, item) => {
    if (!isObject(item)) {
      return total;
    }
    const nested = item[nestedKey];
    return total + (Array.isArray(nested) ? nested.length : 0);
  }, 0);
}

function readNumeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dropsBelowThreshold(current: number, candidate: number, minBase: number, ratio: number): boolean {
  return current >= minBase && candidate / current < ratio;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMirrorText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
