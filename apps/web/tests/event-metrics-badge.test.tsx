import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EventDetailPage from "../app/user/events/[id]/page";

const { __testables } = EventDetailPage as typeof EventDetailPage & {
  __testables: {
    renderExpectedMatchesMetric: (event: {
      totalPartidasPrevistas?: number;
      totalPartidasCalculadas?: number;
      totalPartidas?: number;
      totalPartidasPrevistasFonte?: "observada" | "estimada";
    }) => React.ReactElement;
  };
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("PP-016 T-U-04 badge de partidas previstas exibe indicador quando fonte e observada", () => {
  const html = renderToStaticMarkup(
    __testables.renderExpectedMatchesMetric({
      totalPartidasPrevistas: 9,
      totalPartidasPrevistasFonte: "observada",
    }),
  );

  assert.match(html, /Partidas Previstas/);
  assert.match(html, /calibrado por resultados publicados/);
});
