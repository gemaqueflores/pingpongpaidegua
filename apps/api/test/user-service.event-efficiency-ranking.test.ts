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
