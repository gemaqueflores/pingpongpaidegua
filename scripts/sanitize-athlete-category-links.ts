import { PrismaClient } from "@prisma/client";

function parseArgs(argv: string[]): { eventId: number | null } {
  let eventId: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--eventId" || token === "--event-id") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        eventId = Math.trunc(value);
      }
      index += 1;
    }
  }
  return { eventId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const whereEvent = args.eventId ? `AND c.event_id = ${args.eventId}` : "";
    const updateSql = `
      UPDATE athlete_categories ac
      SET registration_status = 'INSCRITO'::"RegistrationStatus"
      FROM categories c
      WHERE ac.category_id = c.id
        AND ac.registration_status IS NULL
        ${whereEvent}
        AND EXISTS (
          SELECT 1
          FROM match_participants mp
          JOIN matches m ON m.id = mp.match_id
          WHERE mp.athlete_id = ac.athlete_id
            AND m.category_id = ac.category_id
            AND m.event_id = c.event_id
            AND m.phase IN ('GRUPOS', 'RESULTADOS')
        );
    `;

    const deleteSql = `
      DELETE FROM athlete_categories ac
      USING categories c
      WHERE ac.category_id = c.id
        AND ac.registration_status IS NULL
        ${whereEvent};
    `;

    const updated = await prisma.$executeRawUnsafe(updateSql);
    const deleted = await prisma.$executeRawUnsafe(deleteSql);

    console.log(
      JSON.stringify(
        {
          eventId: args.eventId,
          updatedToInscrito: updated,
          deletedNullLinks: deleted,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

