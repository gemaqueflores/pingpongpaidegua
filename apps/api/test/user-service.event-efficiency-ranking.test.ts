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
