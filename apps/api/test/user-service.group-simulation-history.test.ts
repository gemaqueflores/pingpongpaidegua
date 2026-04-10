import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("historical group preferences exclui todos os eventIds do agregado atual", async () => {
  let categoryWhereArg: Record<string, unknown> | null = null;

  const prisma = {
    category: {
      async findMany(args: { where: Record<string, unknown> }) {
        categoryWhereArg = args.where;
        return [];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    inferHistoricalGroupPreferences(input: {
      excludedEventIds: number[];
      categories: Array<{ id: number; normalizedName: string }>;
      athleteCountByCategory: Map<number, number>;
    }): Promise<Map<number, { preferredGroupCount: number | null; sampleSize: number }>>;
  };

  const result = await service.inferHistoricalGroupPreferences({
    excludedEventIds: [44, 45, 46],
    categories: [
      {
        id: 100,
        normalizedName: "absoluto c",
      },
    ],
    athleteCountByCategory: new Map([[100, 8]]),
  });

  assert.deepEqual((categoryWhereArg?.eventId as { notIn?: number[] })?.notIn, [44, 45, 46]);
  assert.deepEqual(result.get(100), { preferredGroupCount: null, sampleSize: 0 });
});
