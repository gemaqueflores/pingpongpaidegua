import assert from "node:assert/strict";
import test from "node:test";
import { UserService } from "../src/user/user.service";

test("event efficiency deduplica medalhistas de dupla no mesmo evento e prioriza categoria oficial", async () => {
  const service = new UserService({} as never, {} as never) as UserService & {
    dedupeEfficiencyMedalistsByEvent: <T extends {
      athleteId: number;
      athleteName: string;
      categoryName: string;
      medalha: "ouro" | "prata" | "bronze";
      unitKey?: string | null;
    }>(
      eventName: string,
      officialCategoryNames: Set<string>,
      medalists: T[],
    ) => T[];
  };

  const result = service.dedupeEfficiencyMedalistsByEvent(
    "2TMB26 - DUPLAS MISTAS",
    new Set(["DUPLA MISTA-ABSOLUTO C"]),
    [
      {
        athleteId: 700,
        athleteName: "EMANUELA # ISACK",
        categoryName: "DUPLA MISTA-ABSOLUTO A",
        medalha: "ouro",
        unitKey: "pair:emanuela isack",
      },
      {
        athleteId: 700,
        athleteName: "EMANUELA # ISACK",
        categoryName: "DUPLA MISTA-ABSOLUTO C",
        medalha: "ouro",
        unitKey: "pair:emanuela isack",
      },
      {
        athleteId: 701,
        athleteName: "EDSON # LUDMILLA",
        categoryName: "DUPLA MISTA-ABSOLUTO A",
        medalha: "prata",
        unitKey: "pair:edson ludmilla",
      },
      {
        athleteId: 701,
        athleteName: "EDSON # LUDMILLA",
        categoryName: "DUPLA MISTA-ABSOLUTO C",
        medalha: "prata",
        unitKey: "pair:edson ludmilla",
      },
      {
        athleteId: 702,
        athleteName: "ALEXANDRE # ANDREZA",
        categoryName: "DUPLA MISTA-ABSOLUTO A",
        medalha: "bronze",
        unitKey: "pair:alexandre andreza",
      },
      {
        athleteId: 702,
        athleteName: "ALEXANDRE # ANDREZA",
        categoryName: "DUPLA MISTA-ABSOLUTO C",
        medalha: "bronze",
        unitKey: "pair:alexandre andreza",
      },
    ],
  );

  assert.equal(result.length, 3);
  assert.equal(result.filter((item) => item.categoryName === "DUPLA MISTA-ABSOLUTO C").length, 3);
  assert.equal(result.filter((item) => item.categoryName === "DUPLA MISTA-ABSOLUTO A").length, 0);
});

test("event efficiency ignora categoria completamente vazia", async () => {
  const prisma = {
    club: {
      async findMany() {
        return [
          {
            id: 132,
            name: "PARÁ CLUBE - PA",
            athletes: [{ id: 700, nameDisplay: "EMANUELA # ISACK", clubId: 132 }],
          },
        ];
      },
    },
    athlete: {
      async findMany() {
        return [];
      },
    },
    category: {
      async findMany() {
        return [{ id: 12, name: "ABSOLUTO C (MAS)", eventId: 46, cbtmCategoryId: "59" }];
      },
    },
    event: {
      async findMany() {
        return [{ id: 46, nivel: "ESTADUAL", nome: "2TMB26 - DUPLAS MISTAS" }];
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

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    getEfficiencyWeights(): Promise<{ pesoOuro: number; pesoPrata: number; pesoBronze: number }>;
    computeEfficiencyRanking(input: { eventIds?: number[] }): Promise<{
      ranking: Array<{
        clubId: number;
        ouro: number;
        prata: number;
        bronze: number;
        totalQuantidade: number;
        totalPontuacao: number;
      }>;
    }>;
  };

  service.getStateCircuitEligibleClubIds = async () => new Set([132]);
  service.getEfficiencyWeights = async () => ({ pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 });

  const result = await service.computeEfficiencyRanking({ eventIds: [46] });
  const para = result.ranking.find((row) => row.clubId === 132);

  assert.ok(para);
  assert.equal(para?.ouro, 0);
  assert.equal(para?.prata, 0);
  assert.equal(para?.bronze, 0);
  assert.equal(para?.totalQuantidade, 0);
  assert.equal(para?.totalPontuacao, 0);
});

test("event efficiency usa athleteCount por atletas unicos com inscricao confirmada", async () => {
  const prisma = {
    club: {
      async findMany() {
        return [
          {
            id: 132,
            name: "PARÁ CLUBE - PA",
            athletes: [
              { id: 10, nameDisplay: "ALICE", clubId: 132 },
              { id: 11, nameDisplay: "ALICE", clubId: 132 },
              { id: 12, nameDisplay: "BIA # CARLA", clubId: 132 },
              { id: 13, nameDisplay: "DORA", clubId: 132 },
            ],
          },
        ];
      },
    },
    athlete: {
      async findMany() {
        return [
          { clubId: 132, nameNormalized: "alice" },
          { clubId: 132, nameNormalized: "dora" },
        ];
      },
    },
    category: {
      async findMany() {
        return [];
      },
    },
    event: {
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

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    getEfficiencyWeights(): Promise<{ pesoOuro: number; pesoPrata: number; pesoBronze: number }>;
    computeEfficiencyRanking(input: { eventIds?: number[] }): Promise<{
      ranking: Array<{
        clubId: number;
        athleteCount: number;
        totalQuantidade: number;
      }>;
    }>;
  };

  service.getStateCircuitEligibleClubIds = async () => new Set([132]);
  service.getEfficiencyWeights = async () => ({ pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 });

  const result = await service.computeEfficiencyRanking({ eventIds: [46] });
  const para = result.ranking.find((row) => row.clubId === 132);

  assert.ok(para);
  assert.equal(para?.athleteCount, 2);
  assert.equal(para?.totalQuantidade, 0);
});

test("event efficiency em escopo agregado deduplica atleta individual repetido entre eventIds", async () => {
  const prisma = {
    club: {
      async findMany() {
        return [
          {
            id: 132,
            name: "PARÁ CLUBE - PA",
            athletes: [
              { id: 10, nameDisplay: "ALICE", clubId: 132 },
              { id: 11, nameDisplay: "ALICE", clubId: 132 },
              { id: 12, nameDisplay: "BIA", clubId: 132 },
            ],
          },
        ];
      },
    },
    athlete: {
      async findMany() {
        return [
          { clubId: 132, nameNormalized: "alice" },
          { clubId: 132, nameNormalized: "bia" },
        ];
      },
    },
    category: {
      async findMany() {
        return [];
      },
    },
    event: {
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

  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    getEfficiencyWeights(): Promise<{ pesoOuro: number; pesoPrata: number; pesoBronze: number }>;
    computeEfficiencyRanking(input: { eventIds?: number[] }): Promise<{
      ranking: Array<{
        clubId: number;
        athleteCount: number;
      }>;
    }>;
  };

  service.getStateCircuitEligibleClubIds = async () => new Set([132]);
  service.getEfficiencyWeights = async () => ({ pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 });

  const result = await service.computeEfficiencyRanking({ eventIds: [44, 45] });
  const para = result.ranking.find((row) => row.clubId === 132);

  assert.ok(para);
  assert.equal(para?.athleteCount, 2);
});

test("PP-015 T-U-01 resolve pesos pela vigencia da data exata", () => {
  const service = new UserService({} as never, {} as never) as UserService & {
    resolveEfficiencyWeightsForDate: (
      versions: Array<{
        dataInicioVigencia: Date;
        dataFimVigencia: Date | null;
        pesoOuro: number;
        pesoPrata: number;
        pesoBronze: number;
      }>,
      referenceDate: Date,
    ) => { pesoOuro: number; pesoPrata: number; pesoBronze: number };
  };

  const versions = [
    {
      dataInicioVigencia: new Date("2020-01-01T00:00:00.000Z"),
      dataFimVigencia: new Date("2025-12-31T23:59:59.999Z"),
      pesoOuro: 100,
      pesoPrata: 60,
      pesoBronze: 30,
    },
    {
      dataInicioVigencia: new Date("2026-01-01T00:00:00.000Z"),
      dataFimVigencia: null,
      pesoOuro: 130,
      pesoPrata: 80,
      pesoBronze: 50,
    },
  ];

  assert.deepEqual(service.resolveEfficiencyWeightsForDate(versions, new Date("2025-06-01T00:00:00.000Z")), {
    pesoOuro: 100,
    pesoPrata: 60,
    pesoBronze: 30,
  });
  assert.deepEqual(service.resolveEfficiencyWeightsForDate(versions, new Date("2026-06-01T00:00:00.000Z")), {
    pesoOuro: 130,
    pesoPrata: 80,
    pesoBronze: 50,
  });
});

test("PP-015 T-U-02 usa registro mais antigo como fallback retroativo", () => {
  const service = new UserService({} as never, {} as never) as UserService & {
    resolveEfficiencyWeightsForDate: (
      versions: Array<{
        dataInicioVigencia: Date;
        dataFimVigencia: Date | null;
        pesoOuro: number;
        pesoPrata: number;
        pesoBronze: number;
      }>,
      referenceDate: Date,
    ) => { pesoOuro: number; pesoPrata: number; pesoBronze: number };
  };

  const result = service.resolveEfficiencyWeightsForDate(
    [
      {
        dataInicioVigencia: new Date("2026-01-01T00:00:00.000Z"),
        dataFimVigencia: null,
        pesoOuro: 140,
        pesoPrata: 90,
        pesoBronze: 55,
      },
    ],
    new Date("2018-03-01T00:00:00.000Z"),
  );

  assert.deepEqual(result, { pesoOuro: 140, pesoPrata: 90, pesoBronze: 55 });
});

test("PP-015 T-U-03 getEfficiencyWeights retorna default quando versoes estao vazias", async () => {
  const prisma = {
    efficiencyConfigVersion: {
      async findMany() {
        return [];
      },
    },
    efficiencyConfig: {
      async findUnique() {
        return { pesoOuro: 999, pesoPrata: 888, pesoBronze: 777 };
      },
    },
  };
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getEfficiencyWeights(referenceDate?: Date): Promise<{ pesoOuro: number; pesoPrata: number; pesoBronze: number }>;
  };

  const result = await service.getEfficiencyWeights(new Date("2026-01-01T00:00:00.000Z"));

  assert.deepEqual(result, { pesoOuro: 130, pesoPrata: 80, pesoBronze: 50 });
});

test("PP-015 T-I-01 ranking global filtra eventos pelo ano de dataInicio", async () => {
  const categoryFilters: unknown[] = [];
  let eventFindManyCalls = 0;
  const prisma = {
    club: {
      async findMany() {
        return [
          {
            id: 1,
            name: "CLUBE 2025",
            athletes: [{ id: 10, nameDisplay: "ATLETA 2025", clubId: 1 }],
          },
        ];
      },
    },
    athlete: {
      async findMany() {
        return [{ clubId: 1, nameNormalized: "atleta 2025" }];
      },
    },
    category: {
      async findMany(args: { where: unknown }) {
        categoryFilters.push(args.where);
        return [{ id: 100, name: "RATING A", eventId: 2025, cbtmCategoryId: "100" }];
      },
    },
    event: {
      async findMany() {
        eventFindManyCalls += 1;
        if (eventFindManyCalls === 1) {
          return [{ id: 2025, dataInicio: new Date("2025-06-01T00:00:00.000Z") }];
        }
        return [{ id: 2025, nivel: "ESTADUAL", nome: "Evento 2025", dataInicio: new Date("2025-06-01T00:00:00.000Z") }];
      },
    },
    efficiencyConfigVersion: {
      async findMany() {
        return [
          {
            dataInicioVigencia: new Date("2020-01-01T00:00:00.000Z"),
            dataFimVigencia: null,
            pesoOuro: 10,
            pesoPrata: 5,
            pesoBronze: 2,
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [
          {
            categoryId: 100,
            athlete: { id: 10, nameDisplay: "ATLETA 2025", clubId: 1 },
          },
        ];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 1,
            categoryId: 100,
            participants: [{ athlete: { id: 10, clubId: 1, nameDisplay: "ATLETA 2025", club: { name: "CLUBE 2025" } } }],
          },
        ];
      },
    },
  };
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    computeEfficiencyRanking(input: { year?: number }): Promise<{
      ranking: Array<{ clubId: number; ouro: number; totalPontuacao: number }>;
    }>;
    buildCategoryAnalyticsMatchFromRaw(match: unknown): unknown;
    computeCategoryPositionByAthleteId(): Map<number, number | null>;
  };
  service.getStateCircuitEligibleClubIds = async () => new Set([1]);
  service.buildCategoryAnalyticsMatchFromRaw = () => ({
    categoryName: "RATING A",
    players: [{ athleteId: 10, name: "ATLETA 2025" }],
    winnerIndex: 0,
    scoreRaw: "3-0",
    scoreFinal: { setsA: 3, setsB: 0 },
    scoreSets: [],
    sets: [],
    phase: "RESULTADOS",
  });
  service.computeCategoryPositionByAthleteId = () => new Map([[10, 1]]);

  const result = await service.computeEfficiencyRanking({ year: 2025 });

  assert.deepEqual(categoryFilters[0], {
    eventId: { in: [2025] },
    OR: [{ cbtmCategoryId: null }, { cbtmCategoryId: { notIn: ["88888888", "99999999"] } }],
  });
  assert.equal(result.ranking[0]?.ouro, 1);
  assert.equal(result.ranking[0]?.totalPontuacao, 30);
});

test("PP-015 T-I-02 ranking global sem ano inclui dataInicio nulo e usa peso por evento", async () => {
  const prisma = {
    club: {
      async findMany() {
        return [
          {
            id: 1,
            name: "CLUBE TODOS",
            athletes: [
              { id: 10, nameDisplay: "ATLETA 2025", clubId: 1 },
              { id: 20, nameDisplay: "ATLETA SEM DATA", clubId: 1 },
            ],
          },
        ];
      },
    },
    athlete: {
      async findMany() {
        return [
          { clubId: 1, nameNormalized: "atleta 2025" },
          { clubId: 1, nameNormalized: "atleta sem data" },
        ];
      },
    },
    category: {
      async findMany() {
        return [
          { id: 100, name: "RATING A", eventId: 2025, cbtmCategoryId: "100" },
          { id: 200, name: "RATING B", eventId: 9999, cbtmCategoryId: "200" },
        ];
      },
    },
    event: {
      async findMany() {
        return [
          { id: 2025, nivel: "ESTADUAL", nome: "Evento 2025", dataInicio: new Date("2025-06-01T00:00:00.000Z") },
          { id: 9999, nivel: "ESTADUAL", nome: "Evento sem data", dataInicio: null },
        ];
      },
    },
    efficiencyConfigVersion: {
      async findMany() {
        return [
          {
            dataInicioVigencia: new Date("2020-01-01T00:00:00.000Z"),
            dataFimVigencia: new Date("2025-12-31T23:59:59.999Z"),
            pesoOuro: 10,
            pesoPrata: 5,
            pesoBronze: 2,
          },
          {
            dataInicioVigencia: new Date("2026-01-01T00:00:00.000Z"),
            dataFimVigencia: null,
            pesoOuro: 20,
            pesoPrata: 10,
            pesoBronze: 5,
          },
        ];
      },
    },
    athleteCategory: {
      async findMany() {
        return [
          { categoryId: 100, athlete: { id: 10, nameDisplay: "ATLETA 2025", clubId: 1 } },
          { categoryId: 200, athlete: { id: 20, nameDisplay: "ATLETA SEM DATA", clubId: 1 } },
        ];
      },
    },
    match: {
      async findMany() {
        return [
          {
            id: 1,
            categoryId: 100,
            participants: [{ athlete: { id: 10, clubId: 1, nameDisplay: "ATLETA 2025", club: { name: "CLUBE TODOS" } } }],
          },
          {
            id: 2,
            categoryId: 200,
            participants: [{ athlete: { id: 20, clubId: 1, nameDisplay: "ATLETA SEM DATA", club: { name: "CLUBE TODOS" } } }],
          },
        ];
      },
    },
  };
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    computeEfficiencyRanking(input: { year?: number }): Promise<{
      ranking: Array<{ clubId: number; ouro: number; totalPontuacao: number }>;
    }>;
    buildCategoryAnalyticsMatchFromRaw(match: { categoryId: number }): unknown;
    computeCategoryPositionByAthleteId(): Map<number, number | null>;
  };
  service.getStateCircuitEligibleClubIds = async () => new Set([1]);
  service.buildCategoryAnalyticsMatchFromRaw = (match) => ({
    categoryName: match.categoryId === 100 ? "RATING A" : "RATING B",
    players: [{ athleteId: match.categoryId === 100 ? 10 : 20, name: "ATLETA" }],
    winnerIndex: 0,
    scoreRaw: "3-0",
    scoreFinal: { setsA: 3, setsB: 0 },
    scoreSets: [],
    sets: [],
    phase: "RESULTADOS",
  });
  service.computeCategoryPositionByAthleteId = () => new Map([[10, 1], [20, 1]]);

  const result = await service.computeEfficiencyRanking({});

  assert.equal(result.ranking[0]?.ouro, 2);
  assert.equal(result.ranking[0]?.totalPontuacao, 60);
});

test("PP-015 T-I-05 carrega versoes de peso uma unica vez por ranking", async () => {
  let versionFindManyCalls = 0;
  const prisma = {
    club: {
      async findMany() {
        return [{ id: 1, name: "CLUBE", athletes: [] }];
      },
    },
    athlete: {
      async findMany() {
        return [];
      },
    },
    category: {
      async findMany() {
        return [];
      },
    },
    event: {
      async findMany() {
        return [];
      },
    },
    efficiencyConfigVersion: {
      async findMany() {
        versionFindManyCalls += 1;
        return [
          {
            dataInicioVigencia: new Date("2026-01-01T00:00:00.000Z"),
            dataFimVigencia: null,
            pesoOuro: 130,
            pesoPrata: 80,
            pesoBronze: 50,
          },
        ];
      },
    },
  };
  const service = new UserService(prisma as never, prisma as never) as UserService & {
    getStateCircuitEligibleClubIds(): Promise<Set<number>>;
    computeEfficiencyRanking(input: Record<string, never>): Promise<unknown>;
  };
  service.getStateCircuitEligibleClubIds = async () => new Set([1]);

  await service.computeEfficiencyRanking({});

  assert.equal(versionFindManyCalls, 1);
});
