import rankingPointsTableJson from "./cbtm-config/ranking_points_table.json";
import ratingEventWeightsJson from "./cbtm-config/rating_event_weights.json";
import ratingBasicDeltaTableJson from "./cbtm-config/rating_basic_delta_table.json";

export type CbtmEventType =
  | "BRASILEIRAO"
  | "SELETIVA_NACIONAL"
  | "COPA_BRASIL_OURO"
  | "COPA_BRASIL_PRATA"
  | "ESTADUAL"
  | "REGIONAL";

export type RankingStage = "1" | "2" | "SF" | "QF" | "OF" | "16F" | "G";

export type RankingPointsTable = Record<CbtmEventType, Record<RankingStage, number>>;
export type RatingEventWeights = Record<CbtmEventType, number>;

export type RatingDeltaBucket = {
  delta_min: number;
  delta_max: number;
  expected_win?: number;
  expected_loss?: number;
  unexpected_win?: number;
  unexpected_loss?: number;
};

export type CbtmRulesConfig = {
  rankingPointsTable: RankingPointsTable;
  ratingEventWeights: RatingEventWeights;
  ratingBasicDeltaTable: RatingDeltaBucket[];
};

const EVENT_TYPES: CbtmEventType[] = [
  "BRASILEIRAO",
  "SELETIVA_NACIONAL",
  "COPA_BRASIL_OURO",
  "COPA_BRASIL_PRATA",
  "ESTADUAL",
  "REGIONAL",
];

const STAGES: RankingStage[] = ["1", "2", "SF", "QF", "OF", "16F", "G"];

function assertNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message);
  }
}

function validateRankingPointsTable(input: unknown): RankingPointsTable {
  if (!input || typeof input !== "object") {
    throw new Error("Config inválida: ranking_points_table.json deve ser um objeto.");
  }

  const source = input as Record<string, unknown>;
  const out = {} as RankingPointsTable;
  for (const eventType of EVENT_TYPES) {
    const row = source[eventType];
    if (!row || typeof row !== "object") {
      throw new Error(`Config inválida: tipo de evento '${eventType}' ausente em ranking_points_table.json.`);
    }
    const rowObj = row as Record<string, unknown>;
    out[eventType] = {} as Record<RankingStage, number>;
    for (const stage of STAGES) {
      const value = rowObj[stage];
      assertNumber(value, `Config inválida: ranking_points_table.${eventType}.${stage} ausente ou não numérico.`);
      out[eventType][stage] = value;
    }
  }
  return out;
}

function validateRatingEventWeights(input: unknown): RatingEventWeights {
  if (!input || typeof input !== "object") {
    throw new Error("Config inválida: rating_event_weights.json deve ser um objeto.");
  }

  const source = input as Record<string, unknown>;
  const out = {} as RatingEventWeights;
  for (const eventType of EVENT_TYPES) {
    const value = source[eventType];
    assertNumber(value, `Config inválida: rating_event_weights.${eventType} ausente ou não numérico.`);
    out[eventType] = value;
  }
  return out;
}

function validateRatingBasicDeltaTable(input: unknown): RatingDeltaBucket[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(
      "Config ausente/inválida: rating_basic_delta_table.json deve conter pelo menos um bucket. Preencha a tabela básica CBTM.",
    );
  }

  const buckets: RatingDeltaBucket[] = [];
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`Config inválida: rating_basic_delta_table[${index}] deve ser objeto.`);
    }
    const row = item as Record<string, unknown>;
    assertNumber(row.delta_min, `Config inválida: rating_basic_delta_table[${index}].delta_min ausente.`);
    assertNumber(row.delta_max, `Config inválida: rating_basic_delta_table[${index}].delta_max ausente.`);

    const bucket: RatingDeltaBucket = {
      delta_min: row.delta_min,
      delta_max: row.delta_max,
    };

    if (typeof row.expected_win === "number") bucket.expected_win = row.expected_win;
    if (typeof row.expected_loss === "number") bucket.expected_loss = row.expected_loss;
    if (typeof row.unexpected_win === "number") bucket.unexpected_win = row.unexpected_win;
    if (typeof row.unexpected_loss === "number") bucket.unexpected_loss = row.unexpected_loss;

    if (
      bucket.expected_win === undefined &&
      bucket.expected_loss === undefined &&
      bucket.unexpected_win === undefined &&
      bucket.unexpected_loss === undefined
    ) {
      throw new Error(
        `Config inválida: rating_basic_delta_table[${index}] sem colunas de pontuação (expected/unexpected).`,
      );
    }

    buckets.push(bucket);
  }

  return buckets.sort((a, b) => a.delta_min - b.delta_min);
}

export function loadCbtmRulesConfigFromRaw(input: {
  rankingPointsTable: unknown;
  ratingEventWeights: unknown;
  ratingBasicDeltaTable: unknown;
}): CbtmRulesConfig {
  return {
    rankingPointsTable: validateRankingPointsTable(input.rankingPointsTable),
    ratingEventWeights: validateRatingEventWeights(input.ratingEventWeights),
    ratingBasicDeltaTable: validateRatingBasicDeltaTable(input.ratingBasicDeltaTable),
  };
}

export function loadCbtmRulesConfig(): CbtmRulesConfig {
  return loadCbtmRulesConfigFromRaw({
    rankingPointsTable: rankingPointsTableJson,
    ratingEventWeights: ratingEventWeightsJson,
    ratingBasicDeltaTable: ratingBasicDeltaTableJson,
  });
}
