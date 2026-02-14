import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.event.upsert({
    where: { cbtmEventId: 5246 },
    update: {
      nome: "5ª etapa TMB/Pa",
      concluido: false,
    },
    create: {
      cbtmEventId: 5246,
      nome: "5ª etapa TMB/Pa",
      concluido: false,
    },
  });

  console.log("Seed concluído: evento 5246 garantido.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
