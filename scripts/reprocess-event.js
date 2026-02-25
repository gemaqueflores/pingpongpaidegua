/* eslint-disable no-console */
const { prisma } = require("/workspace/apps/worker/dist/prisma");
const { ScrapeProcessor } = require("/workspace/apps/worker/dist/pipeline/scrape.processor");

async function main() {
  const eventId = Number(process.argv[2] || 0);
  const mode = String(process.argv[3] || "3").trim();
  if (!Number.isInteger(eventId) || eventId <= 0) {
    throw new Error("uso: node /workspace/scripts/reprocess-event.js <eventId> <2|3|post>");
  }

  const reasonByMode = {
    "2": "scrape-now-force:2",
    "3": "scrape-now-force:3",
    post: "post-scrape-reprocess:manual",
  };
  const reason = reasonByMode[mode];
  if (!reason) {
    throw new Error("modo invalido. use 2, 3 ou post");
  }

  await prisma.$connect();
  try {
    await new ScrapeProcessor().processEventJob(eventId, reason);
    console.log(`OK event=${eventId} mode=${mode}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

