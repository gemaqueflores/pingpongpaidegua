import { describe, expect, it } from "vitest";
import {
  calculateAthletePointPerformance,
  getAthleteMatchOutcome,
  resolveAthleteIndexInMatch,
} from "../src/index";

describe("calculateAthletePointPerformance", () => {
  it("calcula proporcao de pontos corretamente", () => {
    const matches = [
      {
        players: [
          { athleteId: 10, name: "ATLETA A" },
          { athleteId: 20, name: "ATLETA B" },
        ],
        sets: [
          { p1: 11, p2: 7 },
          { p1: 9, p2: 11 },
        ],
      },
    ];

    const resultA = calculateAthletePointPerformance(matches, { athleteId: 10 });
    const resultB = calculateAthletePointPerformance(matches, { athleteId: 20 });

    expect(resultA.pointsWon).toBe(20);
    expect(resultA.pointsPlayed).toBe(38);
    expect(resultA.ratio).toBeCloseTo(20 / 38, 8);

    expect(resultB.pointsWon).toBe(18);
    expect(resultB.pointsPlayed).toBe(38);
    expect(resultB.ratio).toBeCloseTo(18 / 38, 8);
  });

  it("retorna ratio nulo quando nao ha sets validos", () => {
    const matches = [
      {
        players: [
          { athleteId: 10, name: "ATLETA A" },
          { athleteId: 20, name: "ATLETA B" },
        ],
        sets: [],
      },
    ];

    const result = calculateAthletePointPerformance(matches, { athleteId: 10 });
    expect(result.pointsWon).toBe(0);
    expect(result.pointsPlayed).toBe(0);
    expect(result.ratio).toBeNull();
  });

  it("ignora sets invalidos ou sem disputa", () => {
    const matches = [
      {
        players: [
          { athleteId: 10, name: "ATLETA A" },
          { athleteId: 20, name: "ATLETA B" },
        ],
        sets: [
          { p1: 0, p2: 0 },
          { p1: -1, p2: 11 },
          { p1: 11, p2: 9 },
        ],
      },
    ];

    const result = calculateAthletePointPerformance(matches, { athleteId: 10 });
    expect(result.setsUsed).toBe(1);
    expect(result.ignoredSets).toBe(2);
    expect(result.pointsWon).toBe(11);
    expect(result.pointsPlayed).toBe(20);
  });
});

describe("winner consistency (Davi vs Domini fixture)", () => {
  it("mantem winnerIndex consistente independente da pagina do atleta", () => {
    const match = {
      players: [
        { athleteId: 101, name: "DAVI TUMA FURTADO" },
        { athleteId: 202, name: "DOMINI COSTA" },
      ],
      sets: [
        { p1: 7, p2: 11 },
        { p1: 8, p2: 11 },
        { p1: 6, p2: 11 },
      ],
      winnerIndex: 1 as const,
    };

    const daviIndex = resolveAthleteIndexInMatch(match, { athleteId: 101 });
    const dominiIndex = resolveAthleteIndexInMatch(match, { athleteId: 202 });

    expect(daviIndex).toBe(0);
    expect(dominiIndex).toBe(1);

    expect(getAthleteMatchOutcome({ winnerIndex: match.winnerIndex, athleteIndex: daviIndex })).toBe("L");
    expect(getAthleteMatchOutcome({ winnerIndex: match.winnerIndex, athleteIndex: dominiIndex })).toBe("W");
  });
});
