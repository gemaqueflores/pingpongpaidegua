import type { PrismaClient } from "@prisma/client";

type ReadModelCacheClient = Pick<PrismaClient, "readModelCache">;

export function clearEventReadModelCaches(
  client: ReadModelCacheClient,
  eventId: number,
) {
  return client.readModelCache.deleteMany({
    where: { eventId },
  });
}
