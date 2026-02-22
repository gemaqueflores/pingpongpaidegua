import { PrismaClient } from "@prisma/client";

type CliArgs = {
  eventId: number;
  athleteId: number;
};

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const prefixed = `${flag}=`;
    const inline = args.find((arg) => arg.startsWith(prefixed));
    if (inline) {
      return inline.slice(prefixed.length);
    }
    const index = args.indexOf(flag);
    if (index >= 0 && index + 1 < args.length) {
      return args[index + 1];
    }
    return null;
  };

  const eventId = Number(get("--eventId") ?? get("-e") ?? 0);
  const athleteId = Number(get("--athleteId") ?? get("-a") ?? 0);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw new Error("Informe --eventId=<id> válido.");
  }
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    throw new Error("Informe --athleteId=<id> válido.");
  }
  return { eventId, athleteId };
}

async function explain(
  prisma: PrismaClient,
  label: string,
  sql: string,
  params: Array<string | number | boolean | null>,
): Promise<void> {
  const rows = (await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${sql}`,
    ...params,
  )) as Array<Record<string, unknown>>;

  const lines = rows
    .map((row) => String(row["QUERY PLAN"] ?? row["query plan"] ?? ""))
    .filter(Boolean);

  const executionLine = lines.find((line) => line.includes("Execution Time"));
  const planningLine = lines.find((line) => line.includes("Planning Time"));

  console.log(`\n=== ${label} ===`);
  if (planningLine) {
    console.log(planningLine.trim());
  }
  if (executionLine) {
    console.log(executionLine.trim());
  }
  console.log("--- plano (primeiras linhas) ---");
  for (const line of lines.slice(0, 12)) {
    console.log(line);
  }
}

async function main(): Promise<void> {
  const { eventId, athleteId } = parseArgs();
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();

    await explain(
      prisma,
      "events/:id summary base",
      `
      SELECT
        e.id,
        e.nome,
        (
          SELECT COUNT(*)
          FROM categories c
          WHERE c.event_id = e.id
            AND (c.cbtm_category_id IS NULL OR c.cbtm_category_id NOT IN ('88888888', '99999999'))
        ) AS total_categorias,
        (
          SELECT COUNT(*)
          FROM athletes a
          WHERE a.event_id = e.id
            AND a.created_from_warning = false
        ) AS total_inscritos
      FROM events e
      WHERE e.id = $1
      `,
      [eventId],
    );

    await explain(
      prisma,
      "events/:id/athletes list",
      `
      SELECT
        a.id,
        a.name_display,
        a.state_code,
        a.region,
        a.club_id
      FROM athletes a
      WHERE a.event_id = $1
        AND a.created_from_warning = false
      ORDER BY a.name_display ASC
      LIMIT 200
      `,
      [eventId],
    );

    await explain(
      prisma,
      "events/:id/athletes/:athleteId/summary matches",
      `
      SELECT
        m.id,
        m.event_id,
        m.category_id,
        m.phase,
        m.round,
        m.match_datetime,
        m.winner_index
      FROM matches m
      WHERE m.event_id = $1
        AND EXISTS (
          SELECT 1
          FROM match_participants mp
          WHERE mp.match_id = m.id
            AND mp.athlete_id = $2
        )
      ORDER BY m.match_datetime DESC NULLS LAST, m.id DESC
      `,
      [eventId, athleteId],
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[perf] falha: ${String(error)}`);
  process.exit(1);
});

