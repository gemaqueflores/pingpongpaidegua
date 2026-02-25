import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DiscoveredCategory,
  DxPayload,
  EliminationPayload,
  extractDxPayloads,
  parseDxPayloads,
} from "@cbtm/parser";
import {
  compactWhitespace,
  getMatchPhaseOrder,
  getRoundSemanticOrder,
  normalizeText,
} from "@cbtm/shared";

type SmokeMode = "fixture" | "live";

interface CapturedData {
  payloads: DxPayload[];
  categoriesDiscovered: DiscoveredCategory[];
  eliminationPayloads: EliminationPayload[];
}

const eventId = Number(process.env.SMOKE_EVENT_ID ?? "5246");
const mode = (process.env.SMOKE_MODE ?? "fixture") as SmokeMode;
const defaultFixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "golden");
const defaultFixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "results.txt");
const fixtureInputs = (
  process.env.SMOKE_FIXTURE_PATHS ??
  process.env.SMOKE_FIXTURE_PATH ??
  (fs.existsSync(defaultFixtureDir) ? defaultFixtureDir : defaultFixturePath)
)
  .split(/[;,]/g)
  .map((item) => item.trim())
  .filter(Boolean);

function resolveFixtureFiles(): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const input of fixtureInputs) {
    const absoluteInput = path.resolve(input);
    if (!fs.existsSync(absoluteInput)) {
      continue;
    }

    const stat = fs.statSync(absoluteInput);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absoluteInput, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt")) {
          continue;
        }
        const resolved = path.resolve(absoluteInput, entry.name);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          files.push(resolved);
        }
      }
      continue;
    }

    if (!seen.has(absoluteInput)) {
      seen.add(absoluteInput);
      files.push(absoluteInput);
    }
  }

  if (files.length === 0) {
    return [defaultFixturePath];
  }

  return files.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}

function categoriesFromPayloads(payloads: DxPayload[]): DiscoveredCategory[] {
  const seeded = parseDxPayloads(eventId, payloads).categories;
  const namesById = new Map<string, string>();
  for (const category of seeded) {
    if (category.categoryId) {
      namesById.set(category.categoryId, category.categoryName);
    }
  }

  const map = new Map<string, DiscoveredCategory>();
  for (const payload of payloads) {
    if (!payload.categoryId || map.has(payload.categoryId)) {
      continue;
    }
    map.set(payload.categoryId, {
      categoryId: payload.categoryId,
      categoryName: namesById.get(payload.categoryId) ?? `Categoria ${payload.categoryId}`,
      valid: payload.categoryId !== "88888888" && payload.categoryId !== "99999999",
    });
  }
  return [...map.values()];
}

async function captureFixture(): Promise<CapturedData> {
  const fixtureFiles = resolveFixtureFiles();
  const rawBodies = fixtureFiles.map((filePath) => fs.readFileSync(filePath, "utf8"));
  const payloads = rawBodies.flatMap((rawBody) => extractDxPayloads(rawBody));
  return {
    payloads,
    categoriesDiscovered: categoriesFromPayloads(payloads),
    eliminationPayloads: [],
  };
}

async function captureLive(): Promise<CapturedData> {
  process.env.SCRAPER_MODE = "live";
  process.env.SCRAPER_EVENT_URL =
    process.env.SCRAPER_EVENT_URL ?? "https://app.cbtm.org.br/IUI/App/Evento?EVE_Evento_ID={EVENT_ID}";
  process.env.SCRAPER_EXCLUDED_CATEGORY_IDS =
    process.env.SCRAPER_EXCLUDED_CATEGORY_IDS ?? "88888888,99999999";
  const { CaptureService } = await import("../apps/worker/src/scraper/capture.service");
  const capture = await new CaptureService().capture(eventId);
  return {
    payloads: capture.payloads,
    categoriesDiscovered: capture.categoriesDiscovered,
    eliminationPayloads: capture.eliminationPayloads,
  };
}

function orderingExample(dataset: ReturnType<typeof parseDxPayloads>) {
  const appearance = new Map<string, number>();
  for (const match of dataset.matches) {
    appearance.set(match.athleteANormalizedName, (appearance.get(match.athleteANormalizedName) ?? 0) + 1);
    appearance.set(match.athleteBNormalizedName, (appearance.get(match.athleteBNormalizedName) ?? 0) + 1);
  }

  const top = [...appearance.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) {
    return {
      athlete: "-",
      orderedMatches: [] as string[],
    };
  }

  const athleteNormalized = top[0];
  const athleteDisplay =
    dataset.registrations.find((item) => item.athleteNormalizedName === athleteNormalized)?.athleteName ??
    dataset.matches.find((item) => item.athleteANormalizedName === athleteNormalized)?.athleteAName ??
    dataset.matches.find((item) => item.athleteBNormalizedName === athleteNormalized)?.athleteBName ??
    athleteNormalized;

  const athleteMatches = dataset.matches.filter(
    (item) =>
      item.athleteANormalizedName === athleteNormalized || item.athleteBNormalizedName === athleteNormalized,
  );

  athleteMatches.sort((a, b) => {
    const byPhase = getMatchPhaseOrder(a.phase) - getMatchPhaseOrder(b.phase);
    if (byPhase !== 0) {
      return byPhase;
    }

    const byRound = getRoundSemanticOrder(a.round ?? null) - getRoundSemanticOrder(b.round ?? null);
    if (byRound !== 0) {
      return byRound;
    }

    const timeA = a.matchDatetime ? new Date(a.matchDatetime).getTime() : Number.MAX_SAFE_INTEGER;
    const timeB = b.matchDatetime ? new Date(b.matchDatetime).getTime() : Number.MAX_SAFE_INTEGER;
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    const tableA = Number.isFinite(Number(a.tableNumber)) ? Number(a.tableNumber) : Number.MAX_SAFE_INTEGER;
    const tableB = Number.isFinite(Number(b.tableNumber)) ? Number(b.tableNumber) : Number.MAX_SAFE_INTEGER;
    if (tableA !== tableB) {
      return tableA - tableB;
    }

    return a.matchKey.localeCompare(b.matchKey);
  });

  const orderedMatches = athleteMatches.slice(0, 8).map((item) => {
    const dt = item.matchDatetime ? new Date(item.matchDatetime).toISOString() : "sem_horario";
    return [
      compactWhitespace(item.categoryName),
      item.phase,
      compactWhitespace(item.round ?? "-"),
      dt,
      `mesa=${item.tableNumber ?? "-"}`,
      `placar=${item.scoreRaw}`,
    ].join(" | ");
  });

  return {
    athlete: athleteDisplay,
    orderedMatches,
  };
}

async function main() {
  const captured = mode === "live" ? await captureLive() : await captureFixture();
  const dataset = parseDxPayloads(eventId, captured.payloads, {
    categoriesDiscovered: captured.categoriesDiscovered,
    eliminationPayloads: captured.eliminationPayloads,
  });

  const totalCategoriesFound = dataset.extractionStats.totalCategoriesFound;
  const totalCategoriesValid = dataset.extractionStats.totalCategoriesValid;
  const totalAthletes = dataset.extractionStats.uniqueAthletesConsolidated;
  const totalRegistrations = dataset.registrations.length;
  const totalMatches = dataset.matches.length;

  const absolutoAthletes = new Set(
    dataset.registrations
      .filter((item) => item.categoryNormalizedName === normalizeText("ABSOLUTO E (MAS)"))
      .map((item) => `${item.athleteNormalizedName}|${item.clubNormalizedName}`),
  ).size;

  const athleteCategoryCount = new Set(
    dataset.registrations.map(
      (item) =>
        `${item.athleteNormalizedName}|${item.clubNormalizedName}|${item.categoryId ?? "sem_id"}|${item.categoryNormalizedName}`,
    ),
  ).size;

  if (mode === "live" && totalCategoriesValid <= 1) {
    throw new Error(`Smoke falhou: totalCategoriesValid=${totalCategoriesValid}`);
  }
  if (mode === "live" && totalAthletes <= absolutoAthletes && absolutoAthletes > 0) {
    throw new Error(`Smoke falhou: totalAthletes=${totalAthletes} <= absolutoAthletes=${absolutoAthletes}`);
  }
  if (athleteCategoryCount < totalAthletes) {
    throw new Error(`Smoke falhou: athleteCategoryCount=${athleteCategoryCount} < totalAthletes=${totalAthletes}`);
  }

  const discoveredValidCategories = captured.categoriesDiscovered.filter((item) => item.valid);
  const discoveredAllCategories = captured.categoriesDiscovered;
  const expectedByComboTotalAll = discoveredAllCategories.reduce(
    (sum, item) => sum + Number(item.totalListedCount ?? 0),
    0,
  );
  const expectedByComboTotal = discoveredValidCategories.reduce(
    (sum, item) => sum + Number(item.totalListedCount ?? 0),
    0,
  );
  const expectedByComboRegistered = discoveredValidCategories.reduce(
    (sum, item) => sum + Number(item.registeredCount ?? 0),
    0,
  );
  const expectedByComboPreRegistered = discoveredValidCategories.reduce(
    (sum, item) => sum + Number(item.preRegisteredCount ?? 0),
    0,
  );

  const actualByCategory = new Map<string, number>();
  for (const registration of dataset.registrations) {
    if (!registration.categoryId) {
      continue;
    }
    actualByCategory.set(
      registration.categoryId,
      (actualByCategory.get(registration.categoryId) ?? 0) + 1,
    );
  }
  const parserFromCategoriesDiscovered = discoveredValidCategories.reduce(
    (sum, item) => sum + (actualByCategory.get(item.categoryId) ?? 0),
    0,
  );

  const topRegistrationGaps = discoveredValidCategories
    .map((item) => {
      const expected = Number(item.totalListedCount ?? 0);
      const actual = actualByCategory.get(item.categoryId) ?? 0;
      return {
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        expected,
        actual,
        gap: expected - actual,
      };
    })
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 15);

  const example = orderingExample(dataset);
  const categoriesProof = dataset.categories
    .map((category) => {
      const registrations = dataset.registrations.filter(
        (registration) =>
          (registration.categoryId && category.categoryId
            ? registration.categoryId === category.categoryId
            : registration.categoryNormalizedName === category.categoryNormalizedName),
      ).length;
      const matches = dataset.matches.filter(
        (match) =>
          (match.categoryId && category.categoryId
            ? match.categoryId === category.categoryId
            : match.categoryNormalizedName === category.categoryNormalizedName),
      ).length;
      return `${category.categoryName}${category.categoryId ? ` [${category.categoryId}]` : ""}|inscricoes=${registrations}|jogos=${matches}`;
    })
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  console.log("=== SMOKE COUNTS ===");
  console.log(`mode=${mode}`);
  console.log(`total_categories_found=${totalCategoriesFound}`);
  console.log(`total_categories_valid=${totalCategoriesValid}`);
  console.log(`atletas=${totalAthletes}`);
  console.log(`inscricoes=${totalRegistrations}`);
  console.log(`jogos=${totalMatches}`);
  console.log(`athlete_category=${athleteCategoryCount}`);
  console.log(`combo_inscricoes_total=${expectedByComboTotal}`);
  console.log(`combo_inscricoes_total_todas_categorias=${expectedByComboTotalAll}`);
  console.log(`combo_inscritos=${expectedByComboRegistered}`);
  console.log(`combo_pre_inscritos=${expectedByComboPreRegistered}`);
  console.log(`parser_inscricoes_em_categorias_descobertas=${parserFromCategoriesDiscovered}`);
  console.log(
    `cobertura_inscricoes_combo=${expectedByComboTotal > 0 ? ((parserFromCategoriesDiscovered / expectedByComboTotal) * 100).toFixed(1) : "n/a"}%`,
  );
  if (topRegistrationGaps.length > 0) {
    console.log("=== TOP GAPS INSCRICOES (combo - parser) ===");
    for (const gap of topRegistrationGaps) {
      console.log(
        `gap=${gap.categoryName} [${gap.categoryId}] esperado=${gap.expected} parser=${gap.actual} diff=${gap.gap}`,
      );
    }
  }
  console.log("=== PROVA CATEGORIAS ===");
  for (const line of categoriesProof) {
    console.log(`categoria=${line}`);
  }
  console.log("=== EXEMPLO ORDENACAO ===");
  console.log(`atleta=${example.athlete}`);
  for (const line of example.orderedMatches) {
    console.log(`jogo=${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
