import { PrismaClient } from "@prisma/client";
import { computeOfficialCategoryMatchesCount, normalizeText } from "@cbtm/shared";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

type Args = {
  eventId: number;
  json: boolean;
  top: number;
};

type CategoryKind = "RATING" | "RANKING_IDADE" | "RANKING_TECNICO" | "OUTRA";

const TECHNICIAN_CATEGORY_ID = "99999999";
const IGNORED_CATEGORY_IDS = new Set(["88888888", TECHNICIAN_CATEGORY_ID]);

function parseArgs(argv: string[]): Args {
  let eventId = 0;
  let json = false;
  let top = 20;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--eventId" && argv[i + 1]) {
      eventId = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--top" && argv[i + 1]) {
      top = Number(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  if (!Number.isFinite(eventId) || eventId <= 0) {
    throw new Error("Uso: tsx scripts/audit-event-integrity.ts --eventId <cbtmEventId> [--json] [--top 20]");
  }
  if (!Number.isFinite(top) || top <= 0) {
    top = 20;
  }
  return { eventId, json, top };
}

function normalizeCategoryName(name: string): string {
  return normalizeText(name).replace(/\s+/g, " ").trim().toUpperCase();
}

function detectCategoryKind(name: string): CategoryKind {
  const normalized = normalizeCategoryName(name).replace(/\s+/g, "");
  if (/^R[A-Z]{2,3}$/.test(normalized)) {
    return "RATING";
  }
  if (normalized.startsWith("ABSOLUTO")) {
    return "RANKING_TECNICO";
  }
  if (normalized.startsWith("SUB") || normalized.startsWith("ADULTO") || normalized.startsWith("MASTER")) {
    return "RANKING_IDADE";
  }
  return "OUTRA";
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function isWalkoverMatch(input: {
  sets: Array<{ p1: number; p2: number }>;
  p1Sets: number | null;
  p2Sets: number | null;
  scoreRaw?: string | null;
}): { wo: boolean; doubleWo: boolean } {
  const sets = input.sets ?? [];
  const p1Sets = asInt(input.p1Sets, 0);
  const p2Sets = asInt(input.p2Sets, 0);
  const scoreRaw = String(input.scoreRaw ?? "").toLowerCase().replace(/\s+/g, "");

  const all00 = sets.length > 0 && sets.every((set) => set.p1 === 0 && set.p2 === 0);
  if (all00) {
    const explicit00 = (p1Sets === 0 && p2Sets === 0) || scoreRaw.includes("0x0");
    return { wo: explicit00, doubleWo: explicit00 };
  }

  const simpleWoBySets =
    sets.length === 3 &&
    (sets.every((set) => set.p1 === 11 && set.p2 === 0) || sets.every((set) => set.p2 === 11 && set.p1 === 0));
  if (simpleWoBySets) {
    return { wo: true, doubleWo: false };
  }

  const straightWin = (p1Sets === 3 && p2Sets === 0) || (p1Sets === 0 && p2Sets === 3);
  if (!straightWin || sets.length !== 3) {
    return { wo: false, doubleWo: false };
  }
  const winnerIsP1 = p1Sets > p2Sets;
  const validWo = sets.every((set) => (winnerIsP1 ? set.p1 === 11 && set.p2 === 0 : set.p2 === 11 && set.p1 === 0));
  return { wo: validWo, doubleWo: false };
}

function parseSets(payload: unknown): Array<{ p1: number; p2: number }> {
  if (!Array.isArray(payload)) return [];
  const out: Array<{ p1: number; p2: number }> = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { a?: unknown; b?: unknown; p1?: unknown; p2?: unknown };
    const p1 = asInt(row.a ?? row.p1, NaN);
    const p2 = asInt(row.b ?? row.p2, NaN);
    if (!Number.isFinite(p1) || !Number.isFinite(p2)) continue;
    out.push({ p1, p2 });
  }
  return out;
}

function parseOfficialAuditMap(
  extractionStats: unknown,
): Map<
  string,
  {
    registered: number;
    preRegistered: number;
    listed: number;
    officialMatches: number | null;
  }
> {
  const out = new Map<
    string,
    {
      registered: number;
      preRegistered: number;
      listed: number;
      officialMatches: number | null;
    }
  >();

  if (!extractionStats || typeof extractionStats !== "object") {
    return out;
  }
  const capture = (extractionStats as { capture?: unknown }).capture;
  if (!capture || typeof capture !== "object") {
    return out;
  }
  const list = (capture as { categoriesDiscoveredAudit?: unknown }).categoriesDiscoveredAudit;
  if (!Array.isArray(list)) {
    return out;
  }
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      categoryId?: unknown;
      valid?: unknown;
      registeredCount?: unknown;
      preRegisteredCount?: unknown;
      totalListedCount?: unknown;
      officialMatchesCount?: unknown;
    };
    const categoryId = String(row.categoryId ?? "").trim();
    if (!categoryId) continue;
    if (!Boolean(row.valid)) continue;
    const registered = Math.max(0, asInt(row.registeredCount, 0));
    const preRegistered = Math.max(0, asInt(row.preRegisteredCount, 0));
    const listed = Math.max(0, asInt(row.totalListedCount, registered + preRegistered));
    const officialMatchesCount = Number.isFinite(Number(row.officialMatchesCount))
      ? Math.max(0, asInt(row.officialMatchesCount, 0))
      : null;
    out.set(categoryId, {
      registered,
      preRegistered,
      listed,
      officialMatches: officialMatchesCount,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const rootEnv = path.resolve(process.cwd(), ".env");
  const apiEnv = path.resolve(process.cwd(), "apps/api/.env");
  const workerEnv = path.resolve(process.cwd(), "apps/worker/.env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, override: false });
  if (fs.existsSync(apiEnv)) dotenv.config({ path: apiEnv, override: false });
  if (fs.existsSync(workerEnv)) dotenv.config({ path: workerEnv, override: false });

  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const event = await prisma.event.findUnique({
      where: { cbtmEventId: args.eventId },
      select: {
        id: true,
        cbtmEventId: true,
        nome: true,
        dataInicio: true,
        inicioRealizacao: true,
        ratingMatchFormat: true,
      },
    });
    if (!event) {
      throw new Error(`Evento cbtmEventId=${args.eventId} nao encontrado.`);
    }

    const [categories, links, matches, recentRuns] = await Promise.all([
      prisma.category.findMany({
        where: {
          eventId: event.id,
          cbtmCategoryId: { notIn: [...IGNORED_CATEGORY_IDS], not: null },
        },
        select: {
          id: true,
          name: true,
          cbtmCategoryId: true,
        },
        orderBy: [{ name: "asc" }],
      }),
      prisma.athleteCategory.findMany({
        where: {
          category: {
            eventId: event.id,
            cbtmCategoryId: { notIn: [...IGNORED_CATEGORY_IDS], not: null },
          },
          athlete: {
            eventId: event.id,
            createdFromWarning: false,
          },
        },
        select: {
          athleteId: true,
          categoryId: true,
          registrationStatus: true,
          athlete: {
            select: {
              id: true,
              nameDisplay: true,
              nameNormalized: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              cbtmCategoryId: true,
            },
          },
        },
      }),
      prisma.match.findMany({
        where: {
          eventId: event.id,
          phase: { in: ["GRUPOS", "RESULTADOS"] },
          category: {
            cbtmCategoryId: { notIn: [...IGNORED_CATEGORY_IDS], not: null },
          },
        },
        select: {
          id: true,
          categoryId: true,
          p1Sets: true,
          p2Sets: true,
          scoreRaw: true,
          setsJson: true,
          scoreSets: true,
        },
      }),
      prisma.scrapeRun.findMany({
        where: { eventId: event.id },
        orderBy: [{ startedAt: "desc" }],
        take: 30,
        select: { id: true, extractionStats: true, status: true, startedAt: true },
      }),
    ]);

    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const runWithAudit =
      recentRuns.find((run) => parseOfficialAuditMap(run.extractionStats).size > 0) ??
      recentRuns[0] ??
      null;
    const officialAudit = parseOfficialAuditMap(runWithAudit?.extractionStats ?? null);

    const confirmedByCategory = new Map<number, number>();
    const preByCategory = new Map<number, number>();
    const athleteBuckets = new Map<
      number,
      {
        athleteName: string;
        confirmedCategories: Array<{ id: number; name: string; kind: CategoryKind }>;
      }
    >();

    for (const link of links) {
      if (link.registrationStatus === "INSCRITO") {
        confirmedByCategory.set(link.categoryId, (confirmedByCategory.get(link.categoryId) ?? 0) + 1);
        const current = athleteBuckets.get(link.athleteId) ?? {
          athleteName: link.athlete.nameDisplay,
          confirmedCategories: [],
        };
        current.confirmedCategories.push({
          id: link.categoryId,
          name: link.category.name,
          kind: detectCategoryKind(link.category.name),
        });
        athleteBuckets.set(link.athleteId, current);
      } else if (link.registrationStatus === "PRE_INSCRITO") {
        preByCategory.set(link.categoryId, (preByCategory.get(link.categoryId) ?? 0) + 1);
      }
    }

    const matchesByCategory = new Map<number, number>();
    const woByCategory = new Map<number, number>();
    for (const match of matches) {
      matchesByCategory.set(match.categoryId, (matchesByCategory.get(match.categoryId) ?? 0) + 1);
      const sets = parseSets(Array.isArray(match.scoreSets) ? match.scoreSets : match.setsJson);
      const wo = isWalkoverMatch({
        sets,
        p1Sets: match.p1Sets,
        p2Sets: match.p2Sets,
        scoreRaw: match.scoreRaw,
      });
      if (wo.wo) {
        woByCategory.set(match.categoryId, (woByCategory.get(match.categoryId) ?? 0) + (wo.doubleWo ? 2 : 1));
      }
    }

    const categoryAudit = categories.map((category) => {
      const confirmed = confirmedByCategory.get(category.id) ?? 0;
      const pre = preByCategory.get(category.id) ?? 0;
      const published = matchesByCategory.get(category.id) ?? 0;
      const wo = woByCategory.get(category.id) ?? 0;
      const kind = detectCategoryKind(category.name);
      const computedExpected = computeOfficialCategoryMatchesCount(confirmed, {
        categoryName: category.name,
        eventStartDate: event.dataInicio ?? event.inicioRealizacao ?? null,
        ratingMatchFormat: event.ratingMatchFormat ?? "RR_K1",
      });
      const official = category.cbtmCategoryId ? officialAudit.get(category.cbtmCategoryId) : undefined;
      return {
        categoryId: category.id,
        cbtmCategoryId: category.cbtmCategoryId,
        categoryName: category.name,
        categoryKind: kind,
        confirmedRegistrations: confirmed,
        preRegistrations: pre,
        publishedMatches: published,
        walkovers: wo,
        playedMatches: Math.max(0, published - wo),
        expectedMatchesFromConfirmed: computedExpected,
        official: official
          ? {
              registered: official.registered,
              preRegistered: official.preRegistered,
              listed: official.listed,
              officialMatches: official.officialMatches,
            }
          : null,
        diff: {
          registrations: official ? confirmed - official.registered : null,
          preRegistrations: official ? pre - official.preRegistered : null,
          publishedVsExpected: published - computedExpected,
          expectedVsOfficialMatches:
            official && Number.isFinite(Number(official.officialMatches))
              ? computedExpected - Number(official.officialMatches)
              : null,
        },
      };
    });

    const athleteRuleViolations = [...athleteBuckets.entries()]
      .map(([athleteId, row]) => {
        const rating = row.confirmedCategories.filter((c) => c.kind === "RATING");
        const ranking = row.confirmedCategories.filter(
          (c) => c.kind === "RANKING_IDADE" || c.kind === "RANKING_TECNICO",
        );
        const total = row.confirmedCategories.length;
        const invalid = total > 3 || rating.length > 1 || ranking.length > 2;
        return {
          athleteId,
          athleteName: row.athleteName,
          totalConfirmedCategories: total,
          ratingCount: rating.length,
          rankingCount: ranking.length,
          categories: row.confirmedCategories.map((c) => c.name),
          invalid,
        };
      })
      .filter((row) => row.invalid)
      .sort((a, b) => b.totalConfirmedCategories - a.totalConfirmedCategories || a.athleteName.localeCompare(b.athleteName));

    const totals = {
      categories: categories.length,
      registrationsConfirmed: categoryAudit.reduce((sum, row) => sum + row.confirmedRegistrations, 0),
      registrationsPre: categoryAudit.reduce((sum, row) => sum + row.preRegistrations, 0),
      publishedMatches: categoryAudit.reduce((sum, row) => sum + row.publishedMatches, 0),
      walkovers: categoryAudit.reduce((sum, row) => sum + row.walkovers, 0),
      playedMatches: categoryAudit.reduce((sum, row) => sum + row.playedMatches, 0),
      expectedMatchesFromConfirmed: categoryAudit.reduce((sum, row) => sum + row.expectedMatchesFromConfirmed, 0),
      officialRegisteredTotal: categoryAudit.reduce((sum, row) => sum + (row.official?.registered ?? 0), 0),
      officialPreRegisteredTotal: categoryAudit.reduce((sum, row) => sum + (row.official?.preRegistered ?? 0), 0),
      officialMatchesTotal: categoryAudit.reduce((sum, row) => sum + (row.official?.officialMatches ?? 0), 0),
      athletesWithRuleViolation: athleteRuleViolations.length,
    };

    const payload = {
      event: {
        id: event.id,
        cbtmEventId: event.cbtmEventId,
        name: event.nome,
        ratingMatchFormat: event.ratingMatchFormat ?? "RR_K1",
      },
      latestScrapeRun: runWithAudit
        ? {
            id: runWithAudit.id,
            status: runWithAudit.status,
            startedAt: runWithAudit.startedAt,
          }
        : null,
      totals,
      topCategoryDiffs: categoryAudit
        .filter(
          (row) =>
            row.diff.registrations !== 0 ||
            row.diff.preRegistrations !== 0 ||
            row.diff.publishedVsExpected !== 0 ||
            row.diff.expectedVsOfficialMatches !== 0,
        )
        .sort((a, b) => Math.abs(b.diff.publishedVsExpected) - Math.abs(a.diff.publishedVsExpected))
        .slice(0, args.top),
      athleteRuleViolations: athleteRuleViolations.slice(0, args.top),
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`Evento: ${event.nome} (cbtm=${event.cbtmEventId}, id=${event.id})`);
    console.log(`Run auditado: ${runWithAudit ? `#${runWithAudit.id} (${runWithAudit.status})` : "sem run encontrado"}`);
    console.log("");
    console.log("Totais:");
    console.log(`- Categorias: ${totals.categories}`);
    console.log(`- Inscricoes confirmadas: ${totals.registrationsConfirmed}`);
    console.log(`- Pre-inscricoes: ${totals.registrationsPre}`);
    console.log(`- Partidas publicadas (GRUPOS+RESULTADOS): ${totals.publishedMatches}`);
    console.log(`- WO: ${totals.walkovers}`);
    console.log(`- Partidas jogadas: ${totals.playedMatches}`);
    console.log(`- Partidas previstas (calc. por inscritos): ${totals.expectedMatchesFromConfirmed}`);
    console.log(`- Oficial auditado (inscritos/pre/partidas): ${totals.officialRegisteredTotal}/${totals.officialPreRegisteredTotal}/${totals.officialMatchesTotal}`);
    console.log("");
    console.log(`Atletas com violacao da regra de vinculo (2 ranking + 1 rating): ${totals.athletesWithRuleViolation}`);
    for (const row of payload.athleteRuleViolations) {
      console.log(
        `- #${row.athleteId} ${row.athleteName} | total=${row.totalConfirmedCategories} ranking=${row.rankingCount} rating=${row.ratingCount}`,
      );
    }
    console.log("");
    console.log(`Top ${args.top} divergencias por categoria:`);
    for (const row of payload.topCategoryDiffs) {
      console.log(
        `- ${row.categoryName}: insc=${row.confirmedRegistrations} ofc=${row.official?.registered ?? "-"} | pre=${row.preRegistrations} ofc=${row.official?.preRegistered ?? "-"} | publicadas=${row.publishedMatches} previstas=${row.expectedMatchesFromConfirmed} ofcPartidas=${row.official?.officialMatches ?? "-"}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error?.stack ?? error?.message ?? error));
  process.exit(1);
});
