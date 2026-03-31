import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("club efficiency career ignora dupla sintetica de outro clube ao projetar medalhistas", async () => {
  const prisma = {
    club: {
      async findUnique() {
        return { id: 1, name: "CLUBE A" };
      },
    },
    athlete: {
      async findMany() {
        return [{ id: 100, nameDisplay: "ALICE # BIA", eventId: 44 }];
      },
    },
    event: {
      async findMany() {
        return [
          {
            id: 44,
            nome: "2TMB26",
            nivel: "ESTADUAL",
            concluido: true,
            inicioRealizacao: new Date("2026-03-28T00:00:00.000Z"),
            fimRealizacao: new Date("2026-03-29T00:00:00.000Z"),
            dataInicio: new Date("2026-03-28T00:00:00.000Z"),
            dataFim: new Date("2026-03-29T00:00:00.000Z"),
          },
        ];
      },
    },
    category: {
      async findMany() {
        return [
          {
            id: 200,
            eventId: 44,
            name: "ABSOLUTO B (FEM) - DUPLAS",
            cbtmCategoryId: "200",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [
          {
            categoryId: 200,
            athlete: {
              id: 100,
              nameDisplay: "ALICE # BIA",
            },
          },
        ];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 900,
            eventId: 44,
            categoryId: 200,
            category: { id: 200, name: "ABSOLUTO B (FEM) - DUPLAS" },
            participants: [
              {
                athlete: {
                  id: 100,
                  clubId: 1,
                  nameDisplay: "ALICE # BIA",
                  club: { name: "CLUBE A" },
                },
              },
            ],
          },
        ];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    buildCategoryAnalyticsMatchFromRaw: (match: unknown) => unknown;
    computeCategoryPositionByAthleteId: (
      categoryMatches: unknown[],
      athletes: Array<{ athleteId: number; athleteName: string }>,
    ) => Map<number, number | null>;
  };

  service.buildCategoryAnalyticsMatchFromRaw = () => ({
    categoryName: "ABSOLUTO B (FEM) - DUPLAS",
    players: [
      { athleteId: 100, name: "ALICE # BIA" },
      { athleteId: null, name: "CARLA - DORA" },
    ],
    winnerIndex: 0,
    scoreRaw: "3-0",
    scoreFinal: { setsA: 3, setsB: 0 },
    scoreSets: [
      { set: 1, a: 11, b: 9 },
      { set: 2, a: 11, b: 8 },
      { set: 3, a: 11, b: 7 },
    ],
    sets: [
      { p1: 11, p2: 9 },
      { p1: 11, p2: 8 },
      { p1: 11, p2: 7 },
    ],
    phase: "RESULTADOS",
    round: "Única 01",
    matchDatetime: new Date("2026-03-28T10:00:00.000Z"),
  });

  service.computeCategoryPositionByAthleteId = (_matches, athletes) =>
    new Map(
      athletes.map((athlete) => [
        athlete.athleteId,
        athlete.athleteName === "ALICE # BIA" ? 1 : 2,
      ]),
    );

  const result = await service.getClubEfficiencyCareer(1);

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0]?.medalists.length, 1);
  assert.equal(result.history[0]?.medalists[0]?.athleteName, "ALICE # BIA");
  assert.equal(result.history[0]?.ouro, 1);
  assert.equal(result.history[0]?.prata, 0);
  assert.equal(result.athletesContribution.length, 1);
  assert.equal(result.athletesContribution[0]?.athleteName, "ALICE # BIA");
});
