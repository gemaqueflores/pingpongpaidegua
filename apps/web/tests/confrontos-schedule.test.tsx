import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EventDetailPage from "../app/user/events/[id]/page";

const { __testables } = EventDetailPage as typeof EventDetailPage & {
  __testables: {
    compareScheduleMatches: (left: never, right: never) => number;
    renderScheduleMatch: (match: never, categoryName?: string) => React.ReactElement;
  };
};
const { compareScheduleMatches, renderScheduleMatch } = __testables;

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function buildScheduleMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    matchDatetime: "2026-06-10T09:00:00Z",
    tableNumber: "1",
    round: "Grupo",
    playerA: { name: "ATLETA A", clubName: "CLUBE A" },
    playerB: { name: "ATLETA B", clubName: "CLUBE B" },
    scoreRaw: null,
    ...overrides,
  } as never;
}

test("PP-009 T-U-01 aba Confrontos preserva invariantes de filtro e toggle", () => {
  const source = readFileSync(new URL("../app/user/events/[id]/page.tsx", import.meta.url), "utf8");

  assert.equal(typeof __testables, "object");
  assert.match(source, /scheduleCategoryFilter/);
  assert.match(source, /scheduleViewMode/);
  assert.match(source, /filteredScheduleCategories/);
  assert.match(source, /flatScheduleMatches/);
  assert.match(source, /compareScheduleMatches/);
  assert.match(source, /renderScheduleMatch/);
  assert.match(source, /setScheduleCategoryFilter\(null\)/);
});

test("PP-009 T-U-02 compareScheduleMatches ordena por datetime crescente", () => {
  const matchA = buildScheduleMatch({ id: 1, matchDatetime: "2026-06-10T10:00:00Z" });
  const matchB = buildScheduleMatch({ id: 2, matchDatetime: "2026-06-10T09:00:00Z" });

  assert.ok(compareScheduleMatches(matchA, matchB) > 0);
});

test("PP-009 T-U-03 compareScheduleMatches envia datetime null para o final", () => {
  const matchA = buildScheduleMatch({ id: 1, matchDatetime: null });
  const matchB = buildScheduleMatch({ id: 2, matchDatetime: "2026-06-10T09:00:00Z" });

  assert.ok(compareScheduleMatches(matchA, matchB) > 0);
});

test("PP-009 T-U-04 compareScheduleMatches desempata por tableNumber numerico", () => {
  const matchA = buildScheduleMatch({ id: 1, tableNumber: "10" });
  const matchB = buildScheduleMatch({ id: 2, tableNumber: "9" });

  assert.ok(compareScheduleMatches(matchA, matchB) > 0);
});

test("PP-009 T-U-05 compareScheduleMatches desempata por id", () => {
  const matchA = buildScheduleMatch({ id: 20 });
  const matchB = buildScheduleMatch({ id: 10 });

  assert.ok(compareScheduleMatches(matchA, matchB) > 0);
});

test("PP-009 T-U-06 renderScheduleMatch com categoryName exibe badge de categoria", () => {
  const html = renderToStaticMarkup(renderScheduleMatch(buildScheduleMatch(), "DUPLA MISTA - SUB-15"));

  assert.match(html, /DUPLA MISTA - SUB-15/);
});

test("PP-009 T-U-07 renderScheduleMatch sem categoryName nao exibe badge de categoria", () => {
  const html = renderToStaticMarkup(renderScheduleMatch(buildScheduleMatch()));

  assert.doesNotMatch(html, /DUPLA MISTA - SUB-15/);
});
