import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventBuildingState } from "../components/user/EventBuildingState";
import { resolveEventPublishedAt, shouldReloadPublishedTabs } from "../lib/event-published-at";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("T-U-01 evento concluido prioriza lastScrapeAt sobre publishedAt", () => {
  const event = {
    concluido: true,
    publishedAt: "2026-06-19T11:34:05.910Z",
    lastScrapeAt: "2026-06-17T16:13:05.600Z",
  };

  assert.equal(resolveEventPublishedAt(event, event.concluido), "2026-06-17T16:13:05.600Z");
});

test("T-U-02 evento nao concluido mantem prioridade publishedAt", () => {
  const event = {
    concluido: false,
    publishedAt: "2026-06-12T10:00:00.000Z",
    lastScrapeAt: "2026-06-12T09:30:00.000Z",
  };

  assert.equal(resolveEventPublishedAt(event, event.concluido), "2026-06-12T10:00:00.000Z");
});

test("T-U-03 evento concluido sem publishedAt usa lastScrapeAt", () => {
  const event = {
    concluido: true,
    publishedAt: null,
    lastScrapeAt: "2026-06-17T16:13:05.600Z",
  };

  assert.equal(resolveEventPublishedAt(event, event.concluido), "2026-06-17T16:13:05.600Z");
});

test("T-U-04 evento concluido sem timestamps retorna null", () => {
  const event = {
    concluido: true,
    publishedAt: null,
    lastScrapeAt: null,
    _meta: { publishedAt: null },
  };

  assert.equal(resolveEventPublishedAt(event, event.concluido), null);
});

test("T-U-05 concluido ausente mantem prioridade publishedAt", () => {
  const event = {
    publishedAt: "2026-06-12T10:00:00.000Z",
    lastScrapeAt: "2026-06-12T09:30:00.000Z",
  };

  assert.equal(resolveEventPublishedAt(event), "2026-06-12T10:00:00.000Z");
});

test("T-U-06 evento null retorna null", () => {
  assert.equal(resolveEventPublishedAt(null), null);
});

test("T-C-01 pagina de evento usa publishedAt no badge e deps de reload", () => {
  const previous = {
    publishedAt: "2026-06-12T09:00:00.000Z",
    lastScrapeAt: "2026-06-12T09:10:00.000Z",
  };
  const samePublication = {
    publishedAt: "2026-06-12T09:00:00.000Z",
    lastScrapeAt: "2026-06-12T09:30:00.000Z",
  };
  const nextPublication = {
    publishedAt: "2026-06-12T10:00:00.000Z",
    lastScrapeAt: "2026-06-12T10:00:00.000Z",
  };

  assert.equal(resolveEventPublishedAt(previous), "2026-06-12T09:00:00.000Z");
  assert.equal(shouldReloadPublishedTabs(previous, samePublication), false);
  assert.equal(shouldReloadPublishedTabs(previous, nextPublication), true);
});

test("T-C-02 pagina de evento renderiza estado building real sem contadores zerados", () => {
  const html = renderToStaticMarkup(<EventBuildingState />);

  assert.match(html, /Preparando dados/);
  assert.match(html, /Os dados do evento/);
  assert.doesNotMatch(html, /event-metric-card/);
});
