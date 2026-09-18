import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedMatch } from "@cbtm/shared";
import { extractCbtmMatchId } from "../src/pipeline/match-merge";

function buildMatch(metadata: ParsedMatch["metadata"]): ParsedMatch {
  return {
    categoryId: "67",
    categoryName: "SUB-21 FEM",
    categoryNormalizedName: "sub-21 fem",
    phase: "RESULTADOS",
    round: "Final",
    tableNumber: "17",
    matchDatetime: "2026-09-18T14:30:00.000Z",
    athleteAName: "ATLETA A",
    athleteANormalizedName: "atleta a",
    athleteBName: "ATLETA B",
    athleteBNormalizedName: "atleta b",
    scoreRaw: "3-1",
    sets: [],
    setsResult: { p1Sets: 3, p2Sets: 1 },
    winnerIndex: 0,
    matchKey: "match-key",
    metadata,
  };
}

test("T-U-01 normaliza cbtmMatchId numerico com zeros a esquerda", () => {
  assert.equal(extractCbtmMatchId(buildMatch({ jogo: "2" })), "2");
  assert.equal(extractCbtmMatchId(buildMatch({ jogo: "002" })), "2");
});
