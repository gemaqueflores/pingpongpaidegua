import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

type Args = {
  eventId: number;
  top: number;
};

function parseArgs(argv: string[]): Args {
  let eventId = 0;
  let top = 20;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--eventId" && argv[i + 1]) {
      eventId = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--top" && argv[i + 1]) {
      top = Number(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  if (!Number.isFinite(eventId) || eventId <= 0) {
    throw new Error("Uso: tsx scripts/diagnose-stage3-conflicts.ts --eventId <cbtmEventId> [--top 20]");
  }
  if (!Number.isFinite(top) || top <= 0) {
    top = 20;
  }
  return { eventId, top };
}

function parseConflictCategoryId(context: string): string | null {
  const match = String(context ?? "").match(/cat:id:(\d+)\|/i);
  return match?.[1] ?? null;
}

async function main(): Promise<void> {
  // Carrega variaveis de ambiente em ordem: ./.env -> ./apps/worker/.env
  const rootEnvPath = path.resolve(process.cwd(), ".env");
  const workerEnvPath = path.resolve(process.cwd(), "apps/worker/.env");
  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath, override: false });
  }
  if (fs.existsSync(workerEnvPath)) {
    dotenv.config({ path: workerEnvPath, override: false });
  }

  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const event = await prisma.event.findUnique({
      where: { cbtmEventId: args.eventId },
      select: { id: true, cbtmEventId: true, nome: true, concluido: true },
    });
    if (!event) {
      throw new Error(`Evento cbtmEventId=${args.eventId} nao encontrado.`);
    }

    const pending = await prisma.athleteMatchConflict.findMany({
      where: { eventId: event.id, resolvedAthleteId: null },
      select: { context: true, shortName: true, shortNameNormalized: true },
      orderBy: { id: "desc" },
    });

    const categoryCounts = new Map<string, number>();
    const shortNameCounts = new Map<string, number>();
    const shortNameNormSet = new Set<string>();
    for (const row of pending) {
      const cat = parseConflictCategoryId(row.context);
      if (cat) {
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
      }
      const key = row.shortName || row.shortNameNormalized || "";
      if (key) {
        shortNameCounts.set(key, (shortNameCounts.get(key) ?? 0) + 1);
      }
      if (row.shortNameNormalized) {
        shortNameNormSet.add(row.shortNameNormalized);
      }
    }

    const sortedCats = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.top);
    const topCatIds = sortedCats.map(([id]) => id);

    const categories = await prisma.category.findMany({
      where: { eventId: event.id, cbtmCategoryId: { in: topCatIds } },
      select: { id: true, name: true, normalizedName: true, cbtmCategoryId: true },
    });

    const categoryByCbtm = new Map<string, { id: number; name: string; normalizedName: string }>();
    for (const c of categories) {
      if (c.cbtmCategoryId) {
        categoryByCbtm.set(c.cbtmCategoryId, {
          id: c.id,
          name: c.name,
          normalizedName: c.normalizedName,
        });
      }
    }

    const catDbIds = categories.map((c) => c.id);
    const athleteLinks = catDbIds.length
      ? await prisma.athleteCategory.groupBy({
          by: ["categoryId"],
          where: { categoryId: { in: catDbIds } },
          _count: { _all: true },
        })
      : [];
    const linksByCategoryId = new Map<number, number>(
      athleteLinks.map((row) => [row.categoryId, row._count._all] as const),
    );

    const aliases = shortNameNormSet.size
      ? await prisma.athleteAlias.findMany({
          where: {
            athlete: { eventId: event.id, createdFromWarning: false },
            aliasNormalized: { in: [...shortNameNormSet] },
          },
          select: { aliasNormalized: true },
        })
      : [];
    const knownAlias = new Set(aliases.map((a) => a.aliasNormalized));

    console.log(`Evento: ${event.nome} (cbtm=${event.cbtmEventId}, id=${event.id}, concluido=${event.concluido})`);
    console.log(`Conflitos pendentes: ${pending.length}`);
    console.log("");
    console.log("Top categorias CBTM por conflitos pendentes:");
    for (const [cbtmCatId, count] of sortedCats) {
      const dbCat = categoryByCbtm.get(cbtmCatId);
      const links = dbCat ? linksByCategoryId.get(dbCat.id) ?? 0 : 0;
      const dbInfo = dbCat
        ? `dbCategoryId=${dbCat.id} atletas_na_categoria=${links} nome='${dbCat.name}'`
        : "SEM_CATEGORIA_NO_BANCO";
      console.log(`- cbtmCategoryId=${cbtmCatId} conflitos=${count} ${dbInfo}`);
    }

    console.log("");
    const topNames = [...shortNameCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.top);
    console.log("Top nomes curtos em conflitos (e se existe alias no evento):");
    for (const [name, count] of topNames) {
      const normalized = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      const exists = knownAlias.has(normalized) ? "SIM" : "NAO";
      console.log(`- ${name} | conflitos=${count} | alias_evento=${exists}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
