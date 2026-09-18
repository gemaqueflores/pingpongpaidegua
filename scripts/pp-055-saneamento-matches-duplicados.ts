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
  groups: Array<unknown>;
  candidateRemovalMatchIds: number[];
  removedMatchIds: number[];
  cacheInvalidated: boolean;
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
      cbtmMatchId: true,
      fetchedAt: true,
      updatedAt: true,
    },
  });
  const groups = new Map<string, typeof matches>();
  for (const match of matches) {
    const normalizedCbtmMatchId = normalizeCbtmMatchId(match.cbtmMatchId);
    if (!normalizedCbtmMatchId) {
      continue;
    }
    const key = `${match.categoryId}|${normalizedCbtmMatchId}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(match);
    groups.set(key, bucket);
  }

  const candidateRemovalMatchIds: number[] = [];
  for (const group of groups.values()) {
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
    candidateRemovalMatchIds.push(...ordered.slice(1).map((match) => match.id));
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

  return {
    mode: input.execute ? "execute" : "dry-run",
    eventId: input.eventId,
    beforeTotal: matches.length,
    afterTotal,
    categories: [],
    groups: [],
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
