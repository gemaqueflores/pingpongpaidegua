import assert from "node:assert/strict";
import test from "node:test";
import AthleteSummaryPage from "../app/user/events/[id]/athletes/[athleteId]/page";

type SortMode = "recent" | "oldest";

type TestMatch = {
  id: number;
  gameId: string | null;
  matchDatetime: string | null;
  scoreRaw: string;
  scoreFinal: null;
  scoreSets: never[];
  sets: never[];
  setsResult: null;
  round: string | null;
};

const NOW = new Date("2026-09-19T00:11:00-03:00").getTime();

function buildMatch(id: number, matchDatetime: string): TestMatch {
  return {
    id,
    gameId: String(id),
    matchDatetime,
    scoreRaw: "-",
    scoreFinal: null,
    scoreSets: [],
    sets: [],
    setsResult: null,
    round: null,
  };
}

function sortMatches(matches: TestMatch[], sortMode: SortMode): TestMatch[] {
  const testables = (
    AthleteSummaryPage as typeof AthleteSummaryPage & {
      __testables?: {
        compareSummaryMatches: (left: TestMatch, right: TestMatch, sortMode: SortMode, now: number) => number;
      };
    }
  ).__testables;

  assert.ok(testables, "comparador deve estar exposto para teste");
  return [...matches].sort((left, right) => testables.compareSummaryMatches(left, right, sortMode, NOW));
}

test('PP-061 T-U-01 ordena jogos futuros do mais proximo no modo "recent"', () => {
  const matches = [
    buildMatch(3, "2026-09-19T20:30:00-03:00"),
    buildMatch(1, "2026-09-19T18:30:00-03:00"),
    buildMatch(2, "2026-09-19T20:00:00-03:00"),
  ];

  assert.deepEqual(
    sortMatches(matches, "recent").map((match) => match.id),
    [1, 2, 3],
  );
});

test('PP-061 T-U-02 ordena jogos futuros do mais distante no modo "oldest"', () => {
  const matches = [
    buildMatch(1, "2026-09-19T18:30:00-03:00"),
    buildMatch(3, "2026-09-19T20:30:00-03:00"),
    buildMatch(2, "2026-09-19T20:00:00-03:00"),
  ];

  assert.deepEqual(
    sortMatches(matches, "oldest").map((match) => match.id),
    [3, 2, 1],
  );
});
