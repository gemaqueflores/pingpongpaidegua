import assert from "node:assert/strict";
import test from "node:test";
import {
  isResolvedSchedulePlayer,
  publishReadModelPayload,
} from "../src/user/read-model-mirror";

test("T-U-08 comparador adota progressao de placar", () => {
  const result = publishReadModelPayload({
    kind: "event-schedule",
    current: schedulePayload([{ id: 1, matchKey: "X", scoreRaw: null }]),
    candidate: schedulePayload([{ id: 1, matchKey: "X", scoreRaw: "3-1" }]),
    now: new Date("2026-06-12T10:00:00.000Z"),
  });

  assert.equal(result.decision, "published_n1");
  assert.equal(result.payload.categories[0].matches[0].scoreRaw, "3-1");
});

test("T-U-09 comparador preserva partida ausente e adota placar novo", () => {
  const result = publishReadModelPayload({
    kind: "event-schedule",
    current: {
      ...schedulePayload([
        { id: 1, matchKey: "X", scoreRaw: null },
        { id: 2, matchKey: "Y", scoreRaw: "3-0" },
        { id: 3, matchKey: "Z", scoreRaw: "3-2" },
      ]),
      _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
    },
    candidate: schedulePayload([
      { id: 1, matchKey: "X", scoreRaw: "3-1" },
      { id: 2, matchKey: "Y", scoreRaw: "3-0" },
    ]),
  });

  assert.equal(result.decision, "merged");
  const matches = result.payload.categories[0].matches;
  assert.equal(matches.length, 3);
  assert.equal(matches.find((match) => match.matchKey === "X")?.scoreRaw, "3-1");
  assert.equal(matches.find((match) => match.matchKey === "Z")?.preservedFromPublishedAt, "2026-06-12T09:00:00.000Z");
});

test("T-U-10 comparador preserva conteudo quando adversario ou placar regridem", () => {
  for (const name of ["V1", "VENCEDOR DE GRUPO A", "V1 - Silva B"]) {
    assert.equal(isResolvedSchedulePlayer({ id: null, name }), false);
  }

  const result = publishReadModelPayload({
    kind: "event-schedule",
    current: schedulePayload([
      {
        id: 1,
        matchKey: "X",
        scoreRaw: "3-2",
        playerA: { id: 10, name: "Silva A", clubName: "A" },
        playerB: { id: 11, name: "Silva B", clubName: "B" },
      },
    ]),
    candidate: schedulePayload([
      {
        id: 1,
        matchKey: "X",
        scoreRaw: null,
        playerA: { id: null, name: "V1", clubName: null },
        playerB: { id: 11, name: "Silva B", clubName: "B" },
      },
    ]),
  });

  const match = result.payload.categories[0].matches[0];
  assert.equal(result.decision, "merged");
  assert.equal(match.scoreRaw, "3-2");
  assert.equal(match.playerA?.name, "Silva A");
});

test("T-U-11 comparador all-or-nothing mantem N em queda brusca", () => {
  const kept = publishReadModelPayload({
    kind: "event-athletes",
    current: { eventId: 1, items: Array.from({ length: 150 }, (_, id) => ({ id })) },
    candidate: { eventId: 1, items: Array.from({ length: 90 }, (_, id) => ({ id })) },
  });
  const published = publishReadModelPayload({
    kind: "event-athletes",
    current: { eventId: 1, items: Array.from({ length: 150 }, (_, id) => ({ id })) },
    candidate: { eventId: 1, items: Array.from({ length: 140 }, (_, id) => ({ id })) },
  });

  assert.equal(kept.decision, "kept_n");
  assert.equal(kept.payload.items.length, 150);
  assert.equal(published.decision, "published_n1");
  assert.equal(published.payload.items.length, 140);
});

test("T-U-12 modo replace ignora regressao", () => {
  const result = publishReadModelPayload({
    kind: "event-athletes",
    mode: "replace",
    current: { eventId: 1, items: Array.from({ length: 150 }, (_, id) => ({ id })) },
    candidate: { eventId: 1, items: Array.from({ length: 10 }, (_, id) => ({ id })) },
  });

  assert.equal(result.decision, "replace");
  assert.equal(result.payload.items.length, 10);
});

test("T-U-13 publishedAt avanca apenas quando publica ou mergeia", () => {
  const now = new Date("2026-06-12T10:00:00.000Z");
  const kept = publishReadModelPayload({
    kind: "event-athletes",
    current: {
      eventId: 1,
      items: Array.from({ length: 150 }, (_, id) => ({ id })),
      _meta: { publishedAt: "2026-06-12T09:00:00.000Z" },
    },
    candidate: { eventId: 1, items: Array.from({ length: 90 }, (_, id) => ({ id })) },
    now,
  });
  const published = publishReadModelPayload({
    kind: "event-athletes",
    current: { eventId: 1, items: [{ id: 1 }] },
    candidate: { eventId: 1, items: [{ id: 1 }, { id: 2 }] },
    now,
  });

  assert.equal(kept.payload._meta?.publishedAt, "2026-06-12T09:00:00.000Z");
  assert.equal(published.payload._meta?.publishedAt, "2026-06-12T10:00:00.000Z");
});

function schedulePayload(matches: Array<Record<string, unknown>>) {
  return {
    eventId: 1,
    categories: [
      {
        categoryId: 10,
        categoryName: "ABSOLUTO",
        matches: matches.map((match) => ({
          id: Number(match.id),
          matchKey: String(match.matchKey),
          round: "FINAL",
          tableNumber: "1",
          matchDatetime: null,
          scoreRaw: (match.scoreRaw as string | null | undefined) ?? null,
          playerA: (match.playerA as any) ?? { id: 1, name: "Atleta A", clubName: "A" },
          playerB: (match.playerB as any) ?? { id: 2, name: "Atleta B", clubName: "B" },
        })),
      },
    ],
  };
}
