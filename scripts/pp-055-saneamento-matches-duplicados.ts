import type { PrismaClient } from "@prisma/client";
import { normalizeCbtmMatchId } from "../apps/worker/src/pipeline/match-merge";
import { prismaRead, prismaWrite } from "../apps/worker/src/prisma";

export interface CleanupArgs {
  eventId: number;
  execute: boolean;
}

export interface DuplicateMatchCleanupReport {
  mode: "dry-run" | "execute";
  eventId: number;
  beforeTotal: number;
  afterTotal: number;
  categories: Array<{
    categoryId: number;
    categoryName: string;
    before: number;
    after: number;
  }>;
  groups: DuplicateMatchGroupReport[];
  candidateRemovalMatchIds: number[];
  removedMatchIds: number[];
  cacheInvalidated: boolean;
}

export interface CleanupMatchSummary {
  id: number;
  cbtmMatchId: string;
  tableNumber: string | null;
  matchDatetime: string | null;
  fetchedAt: string | null;
  updatedAt: string;
}

export interface DuplicateMatchGroupReport {
  categoryId: number;
  categoryName: string;
  cbtmMatchId: string;
  status: "eligible" | "ambiguous";
  kept: CleanupMatchSummary;
  obsolete: CleanupMatchSummary[];
  reason: string | null;
}

function hasPersistedResultSignal(match: { scoreRaw: string; setsJson: unknown }): boolean {
  if (match.scoreRaw.trim().length > 0) {
    return true;
  }
  if (Array.isArray(match.setsJson)) {
    return match.setsJson.length > 0;
  }
  if (match.setsJson && typeof match.setsJson === "object") {
    return Object.keys(match.setsJson).length > 0;
  }
  return typeof match.setsJson === "string" && match.setsJson.trim().length > 0;
}

export function parseArgs(argv: string[]): CleanupArgs {
  let eventId: number | null = null;
  let execute = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--execute") {
      execute = true;
      continue;
    }
    if (token === "--event-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--event-id exige um valor inteiro positivo.");
      }
      eventId = Number(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--event-id=")) {
      eventId = Number(token.slice("--event-id=".length));
      continue;
    }
    throw new Error(`Argumento desconhecido: ${token}`);
  }

  if (!Number.isInteger(eventId) || Number(eventId) <= 0) {
    throw new Error(
      "Uso: tsx scripts/pp-055-saneamento-matches-duplicados.ts --event-id <id> [--execute]",
    );
  }

  return { eventId: Number(eventId), execute };
}

export async function runDuplicateMatchCleanup(input: {
  prisma: PrismaClient;
  eventId: number;
  execute: boolean;
}): Promise<DuplicateMatchCleanupReport> {
  const event = await input.prisma.event.findUnique({
    where: { id: input.eventId },
    select: { id: true },
  });
  if (!event) {
    throw new Error(`Evento id=${input.eventId} nao encontrado.`);
  }

  const matches = await input.prisma.match.findMany({
    where: { eventId: input.eventId },
    select: {
      id: true,
      categoryId: true,
      category: { select: { name: true } },
      cbtmMatchId: true,
      tableNumber: true,
      matchDatetime: true,
      scoreRaw: true,
      setsJson: true,
      fetchedAt: true,
      updatedAt: true,
    },
  });
  const matchesByGroup = new Map<string, typeof matches>();
  for (const match of matches) {
    const normalizedCbtmMatchId = normalizeCbtmMatchId(match.cbtmMatchId);
    if (!normalizedCbtmMatchId) {
      continue;
    }
    const key = `${match.categoryId}|${normalizedCbtmMatchId}`;
    const bucket = matchesByGroup.get(key) ?? [];
    bucket.push(match);
    matchesByGroup.set(key, bucket);
  }

  const candidateRemovalMatchIds: number[] = [];
  const duplicateGroups: DuplicateMatchGroupReport[] = [];
  const removalCountByCategoryId = new Map<number, number>();
  for (const group of matchesByGroup.values()) {
    if (group.length < 2) {
      continue;
    }
    const ordered = [...group].sort((left, right) => {
      const leftTimestamp = (left.fetchedAt ?? left.updatedAt).getTime();
      const rightTimestamp = (right.fetchedAt ?? right.updatedAt).getTime();
      return (
        rightTimestamp - leftTimestamp ||
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        right.id - left.id
      );
    });
    const [kept, ...obsolete] = ordered;
    const normalizedCbtmMatchId = normalizeCbtmMatchId(kept.cbtmMatchId);
    if (!normalizedCbtmMatchId) {
      continue;
    }
    const toSummary = (match: (typeof matches)[number]): CleanupMatchSummary => ({
      id: match.id,
      cbtmMatchId: normalizedCbtmMatchId,
      tableNumber: match.tableNumber,
      matchDatetime: match.matchDatetime?.toISOString() ?? null,
      fetchedAt: match.fetchedAt?.toISOString() ?? null,
      updatedAt: match.updatedAt.toISOString(),
    });
    const ambiguous = obsolete.some(hasPersistedResultSignal);
    if (!ambiguous) {
      candidateRemovalMatchIds.push(...obsolete.map((match) => match.id));
      removalCountByCategoryId.set(
        kept.categoryId,
        (removalCountByCategoryId.get(kept.categoryId) ?? 0) + obsolete.length,
      );
    }
    duplicateGroups.push({
      categoryId: kept.categoryId,
      categoryName: kept.category.name,
      cbtmMatchId: normalizedCbtmMatchId,
      status: ambiguous ? "ambiguous" : "eligible",
      kept: toSummary(kept),
      obsolete: obsolete.map(toSummary),
      reason: ambiguous
        ? "Linha obsoleta possui sinal de resultado persistido; requer decisao manual."
        : null,
    });
  }

  let removedMatchIds: number[] = [];
  if (input.execute && candidateRemovalMatchIds.length > 0) {
    await input.prisma.match.deleteMany({
      where: {
        eventId: input.eventId,
        id: { in: candidateRemovalMatchIds },
      },
    });
    removedMatchIds = [...candidateRemovalMatchIds];
  }

  const afterTotal = input.execute
    ? await input.prisma.match.count({ where: { eventId: input.eventId } })
    : matches.length;
  const categoryCounts = new Map<number, { categoryName: string; before: number }>();
  for (const match of matches) {
    const current = categoryCounts.get(match.categoryId) ?? {
      categoryName: match.category.name,
      before: 0,
    };
    current.before += 1;
    categoryCounts.set(match.categoryId, current);
  }
  const categories = [...categoryCounts.entries()]
    .map(([categoryId, count]) => ({
      categoryId,
      categoryName: count.categoryName,
      before: count.before,
      after: input.execute
        ? count.before - (removalCountByCategoryId.get(categoryId) ?? 0)
        : count.before,
    }))
    .sort((left, right) => left.categoryId - right.categoryId);

  return {
    mode: input.execute ? "execute" : "dry-run",
    eventId: input.eventId,
    beforeTotal: matches.length,
    afterTotal,
    categories,
    groups: duplicateGroups,
    candidateRemovalMatchIds,
    removedMatchIds,
    cacheInvalidated: false,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = args.execute ? prismaWrite : prismaRead;
  try {
    const report = await runDuplicateMatchCleanup({
      prisma: client,
      eventId: args.eventId,
      execute: args.execute,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
