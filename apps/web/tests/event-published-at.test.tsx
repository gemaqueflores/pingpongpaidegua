import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "../components/ui/EmptyState";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("T-C-01 pagina de evento usa publishedAt no badge e deps de reload", () => {
  const source = readFileSync(new URL("../app/user/events/[id]/page.tsx", import.meta.url), "utf8");

  assert.match(source, /const eventPublishedAt = event\?\.publishedAt \?\? event\?\._meta\?\.publishedAt \?\? event\?\.lastScrapeAt/);
  assert.match(source, /formatDateTime\(eventPublishedAt\)/);
  assert.doesNotMatch(source, /\[activeTab, eventId, event\?\.lastScrapeAt\]/);
});

test("T-C-02 pagina de evento renderiza estado building sem contadores zerados", () => {
  const source = readFileSync(new URL("../app/user/events/[id]/page.tsx", import.meta.url), "utf8");
  const html = renderToStaticMarkup(
    <EmptyState
      title="Preparando dados"
      description="Os dados do evento estão sendo preparados. As abas serão atualizadas quando o primeiro espelho estiver publicado."
    />,
  );

  assert.match(source, /eventBuilding/);
  assert.match(source, /Preparando dados/);
  assert.match(source, /!eventBuilding \? <div className="event-metrics">/);
  assert.match(html, /Preparando dados/);
});
