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

test("club efficiency career deduplica a mesma dupla no mesmo evento e prioriza categoria oficial", async () => {
  const prisma = {
    club: {
      async findUnique() {
        return { id: 1, name: "CLUBE A" };
      },
    },
    athlete: {
      async findMany() {
        return [{ id: 100, nameDisplay: "ALICE # BIA", eventId: 46 }];
      },
    },
    event: {
      async findMany() {
        return [
          {
            id: 46,
            nome: "2TMB26 - DUPLAS MISTAS",
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
            id: 10,
            eventId: 46,
            name: "DUPLA MISTA-ABSOLUTO A",
            cbtmCategoryId: null,
          },
          {
            id: 11,
            eventId: 46,
            name: "DUPLA MISTA-ABSOLUTO C",
            cbtmCategoryId: "156",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [
          {
            categoryId: 10,
            athlete: {
              id: 100,
              nameDisplay: "ALICE # BIA",
            },
          },
          {
            categoryId: 11,
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
            eventId: 46,
            categoryId: 10,
            category: { id: 10, name: "DUPLA MISTA-ABSOLUTO A" },
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
          {
            id: 901,
            eventId: 46,
            categoryId: 11,
            category: { id: 11, name: "DUPLA MISTA-ABSOLUTO C" },
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
    buildCategoryAnalyticsMatchFromRaw: (match: { categoryId: number }) => unknown;
    computeCategoryPositionByAthleteId: (
      categoryMatches: unknown[],
      athletes: Array<{ athleteId: number; athleteName: string }>,
    ) => Map<number, number | null>;
  };

  service.buildCategoryAnalyticsMatchFromRaw = (match) => ({
    categoryName: match.categoryId === 10 ? "DUPLA MISTA-ABSOLUTO A" : "DUPLA MISTA-ABSOLUTO C",
    players: [
      { athleteId: 100, name: "ALICE # BIA" },
      { athleteId: null, name: "CARLA # DORA" },
    ],
    winnerIndex: 1,
    scoreRaw: "1-3",
    scoreFinal: { setsA: 1, setsB: 3 },
    scoreSets: [
      { set: 1, a: 11, b: 9 },
      { set: 2, a: 6, b: 11 },
      { set: 3, a: 7, b: 11 },
      { set: 4, a: 8, b: 11 },
    ],
    sets: [
      { p1: 11, p2: 9 },
      { p1: 6, p2: 11 },
      { p1: 7, p2: 11 },
      { p1: 8, p2: 11 },
    ],
    phase: "RESULTADOS",
    round: "Semifinal",
    matchDatetime: new Date("2026-03-28T10:00:00.000Z"),
  });

  service.computeCategoryPositionByAthleteId = (_matches, athletes) =>
    new Map(athletes.map((athlete) => [athlete.athleteId, athlete.athleteName === "ALICE # BIA" ? 3 : 1]));

  const result = await service.getClubEfficiencyCareer(1);

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0]?.medalists.length, 1);
  assert.equal(result.history[0]?.medalists[0]?.athleteName, "ALICE # BIA");
  assert.equal(result.history[0]?.medalists[0]?.categoryName, "DUPLA MISTA-ABSOLUTO C");
  assert.equal(result.history[0]?.bronze, 1);
  assert.equal(result.history[0]?.totalQuantidade, 1);
});

test("club efficiency career preserva nome canonico da dupla ao recomputar athletesContribution", async () => {
  const prisma = {
    club: {
      async findUnique() {
        return { id: 1, name: "CLUBE A" };
      },
    },
    athlete: {
      async findMany() {
        return [{ id: 999, nameDisplay: "ATLETA BASE", eventId: 45 }];
      },
    },
    event: {
      async findMany() {
        return [
          {
            id: 45,
            nome: "2TMB26 - DUPLAS",
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
            eventId: 45,
            name: "ABSOLUTO B (FEM) - DUPLAS",
            cbtmCategoryId: "200",
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 900,
            eventId: 45,
            categoryId: 200,
            category: { id: 200, name: "ABSOLUTO B (FEM) - DUPLAS" },
            participants: [
              {
                athlete: {
                  id: 100,
                  clubId: 1,
                  nameDisplay: "ANDREZA MOTA - LUDMILLA LIMA",
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
    buildCategoryAnalyticsMatchFromRaw: () => unknown;
    computeCategoryPositionByAthleteId: (
      categoryMatches: unknown[],
      athletes: Array<{ athleteId: number; athleteName: string }>,
    ) => Map<number, number | null>;
  };

  service.buildCategoryAnalyticsMatchFromRaw = () => ({
    categoryName: "ABSOLUTO B (FEM) - DUPLAS",
    players: [
      { athleteId: 100, name: "ANDREZA MOTA - LUDMILLA LIMA" },
      { athleteId: -101, name: "CARLA - DORA" },
    ],
    winnerIndex: 0,
    scoreRaw: "3-0",
    scoreFinal: { setsA: 3, setsB: 0 },
    scoreSets: [
      { set: 1, a: 11, b: 5 },
      { set: 2, a: 11, b: 6 },
      { set: 3, a: 11, b: 7 },
    ],
    sets: [
      { p1: 11, p2: 5 },
      { p1: 11, p2: 6 },
      { p1: 11, p2: 7 },
    ],
    phase: "RESULTADOS",
    round: "Única 01",
    matchDatetime: new Date("2026-03-28T10:00:00.000Z"),
  });

  service.computeCategoryPositionByAthleteId = (_matches, athletes) =>
    new Map(athletes.map((athlete) => [athlete.athleteId, athlete.athleteName === "ANDREZA MOTA - LUDMILLA LIMA" ? 1 : 2]));

  const result = await service.getClubEfficiencyCareer(1);

  assert.equal(result.history.length, 1);
  assert.equal(result.athletesContribution.length, 1);
  assert.equal(result.athletesContribution[0]?.athleteName, "ANDREZA MOTA - LUDMILLA LIMA");
  assert.equal(result.athletesContribution[0]?.ouro, 1);
});

test("club efficiency career usa contagem de atletas unicos com inscricao confirmada no resumo do evento", async () => {
  const prisma = {
    club: {
      async findUnique() {
        return { id: 1, name: "CLUBE A" };
      },
    },
    athlete: {
      async findMany(args?: { select?: Record<string, unknown> }) {
        if (args?.select && "nameNormalized" in args.select) {
          return [
            { eventId: 45, nameNormalized: "alice" },
            { eventId: 45, nameNormalized: "dora" },
          ];
        }
        return [
          { id: 100, nameDisplay: "ALICE", eventId: 45 },
          { id: 101, nameDisplay: "ALICE", eventId: 45 },
          { id: 102, nameDisplay: "BIA # CARLA", eventId: 45 },
          { id: 103, nameDisplay: "DORA", eventId: 45 },
        ];
      },
    },
    event: {
      async findMany() {
        return [
          {
            id: 45,
            nome: "2TMB26 - DUPLAS",
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
        return [];
      },
    },
    athleteCategory: {
      async findMany() {
        return [];
      },
    },
    match: {
      async findMany() {
        return [];
      },
    },
  };

  const service = new UserService(prisma as never, prisma as never) as UserService;
  const result = await service.getClubEfficiencyCareer(1);

  assert.equal(result.summary.ultimoEventoId, 45);
  assert.equal(result.summary.nAtletasUltimoEvento, 2);
});
