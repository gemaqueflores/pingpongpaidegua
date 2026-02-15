"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  apiGetEvents,
  apiGetGroupSimulation,
  type GroupSimulationResponse,
  type GroupSimulationScope,
  type UserEventRow,
} from "../../../../../lib/user-api";
import { ShareActions } from "../../../../../components/share/ShareActions";
import { createGroupSimulationShareImageBlob } from "../../../../../lib/share-image";
import { HeroTitle } from "../../../../../components/ui/HeroTitle";
import { Card } from "../../../../../components/ui/Card";
import { Skeleton } from "../../../../../components/ui/Skeleton";
import { Badge } from "../../../../../components/ui/Badge";

type EventRow = UserEventRow;

const SCOPE_LABEL: Record<GroupSimulationScope, string> = {
  confirmed: "Somente inscritos",
  confirmed_and_pre: "Inscritos + pré-inscritos",
};

function getCategoryGenderBucket(categoryName: string): number {
  const normalized = categoryName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (/\bFEM(ININO)?\b/.test(normalized)) {
    return 0;
  }
  if (/\bMAS(CULINO)?\b/.test(normalized)) {
    return 1;
  }
  if (/\bMIST[OA]?\b/.test(normalized) || /\bMIXTO\b/.test(normalized)) {
    return 2;
  }
  return 3;
}

function isRatingCategory(categoryName: string, sortBasis?: "rating" | "ranking"): boolean {
  if (sortBasis) {
    return sortBasis === "rating";
  }
  return categoryName.trim().toUpperCase().startsWith("R");
}

export default function GroupSimulatorPage() {
  const params = useParams<{ id: string }>();
  const eventId = Number(params.id);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [scope, setScope] = useState<GroupSimulationScope>("confirmed");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<GroupSimulationResponse | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(true);

  useEffect(() => {
    void apiGetEvents().then((events) => {
      setEvent((events as EventRow[]).find((item) => item.id === eventId) ?? null);
    });
  }, [eventId]);

  useEffect(() => {
    if (!event) {
      return;
    }
    if (!event.groupSimulationEligible || event.groupsDefined) {
      setError("Simulador indisponível para este evento.");
      setResponse(null);
      return;
    }

    setLoading(true);
    setError(null);
    void apiGetGroupSimulation(eventId, { registrationScope: scope })
      .then((payload) => setResponse(payload))
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "Falha ao carregar simulação."),
      )
      .finally(() => setLoading(false));
  }, [event, eventId, scope]);

  const sortedCategories = useMemo(() => {
    if (!response) {
      return [];
    }

    return [...response.categories].sort((left, right) => {
      const genderLeft = getCategoryGenderBucket(left.categoryName);
      const genderRight = getCategoryGenderBucket(right.categoryName);
      if (genderLeft !== genderRight) {
        return genderLeft - genderRight;
      }
      return left.categoryName.localeCompare(right.categoryName, "pt-BR", { sensitivity: "base" });
    });
  }, [response]);

  useEffect(() => {
    if (sortedCategories.length === 0) {
      setSelectedCategoryId(null);
      return;
    }

    const exists = selectedCategoryId !== null && sortedCategories.some((category) => category.categoryId === selectedCategoryId);
    if (!exists) {
      setSelectedCategoryId(sortedCategories[0].categoryId);
    }
  }, [selectedCategoryId, sortedCategories]);

  const hasCategories = sortedCategories.length > 0;
  const searchedCategories = useMemo(() => {
    const query = categorySearch.trim().toUpperCase();
    if (!query) {
      return sortedCategories;
    }
    return sortedCategories.filter((category) => category.categoryName.toUpperCase().includes(query));
  }, [categorySearch, sortedCategories]);

  const visibleCategories = useMemo(() => {
    if (selectedCategoryId === null) {
      return searchedCategories.slice(0, 1);
    }
    const selected = searchedCategories.find((category) => category.categoryId === selectedCategoryId);
    if (selected) {
      return [selected];
    }
    return searchedCategories.slice(0, 1);
  }, [searchedCategories, selectedCategoryId]);

  return (
    <main className="container grid user-page">
      <HeroTitle
        title="Simulador de Grupos"
        subtitle="Arena de projeção de grupos"
        actions={
          <>
            <button onClick={() => (window.location.href = `/user/events/${eventId}`)}>Voltar ao evento</button>
            <button className="secondary" onClick={() => (window.location.href = "/")}>
              Home
            </button>
          </>
        }
      />

      <Card className="grid">
        <h2>{event?.nome ?? `Evento ${eventId}`}</h2>
        <div className="balloon-group" role="group" aria-label="Escopo de inscritos">
          <button
            className={`balloon-button ${scope === "confirmed" ? "active" : ""}`}
            onClick={() => setScope("confirmed")}
            type="button"
          >
            {SCOPE_LABEL.confirmed}
          </button>
          <button
            className={`balloon-button ${scope === "confirmed_and_pre" ? "active" : ""}`}
            onClick={() => setScope("confirmed_and_pre")}
            type="button"
          >
            Incluir pré-inscritos
          </button>
        </div>
        {loading ? (
          <div className="grid">
            <Skeleton height="24px" />
            <Skeleton height="24px" />
            <Skeleton height="120px" />
          </div>
        ) : null}
        {error ? <p className="warn">{error}</p> : null}
        {!loading && !error && response ? (
          <>
            {!hasCategories ? <p>Nenhuma categoria disponível para simulação neste escopo.</p> : null}

            {hasCategories ? (
              <div className="sim-category-carousel">
                <div className="sim-category-carousel-header">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>Filtro de categoria</h3>
                    <span className="arena-muted" title="Atleta: nome reduzido ou completo; Clube: agremiação; Pontos: ranking ou rating conforme categoria.">
                      Legenda das colunas
                    </span>
                  </div>
                  <label className="arena-muted" htmlFor="group-sim-category-search">Buscar categoria</label>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <p className="sim-category-carousel-counter">
                      {visibleCategories.length > 0 ? "Categoria selecionada para simulação" : "Nenhuma categoria encontrada"}
                    </p>
                    <button type="button" className="secondary" onClick={() => setFilterOpen((current) => !current)}>
                      {filterOpen ? "Recolher filtros" : "Expandir filtros"}
                    </button>
                  </div>
                  {filterOpen ? (
                    <>
                      <input
                        id="group-sim-category-search"
                        value={categorySearch}
                        onChange={(event) => setCategorySearch(event.target.value)}
                        placeholder="Digite para filtrar categorias"
                      />
                      <select
                        value={selectedCategoryId ?? ""}
                        onChange={(event) => setSelectedCategoryId(Number(event.target.value))}
                        aria-label="Selecionar categoria"
                        disabled={searchedCategories.length === 0}
                      >
                        {searchedCategories.length === 0 ? <option value="">Nenhuma categoria</option> : null}
                        {searchedCategories.map((category) => (
                          <option key={category.categoryId} value={category.categoryId}>
                            {category.categoryName}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  {visibleCategories.length > 0 ? (
                    <div className="row">
                      <span className="ui-badge ui-badge-open">Categoria: {visibleCategories[0].categoryName}</span>
                      <button type="button" className="secondary" onClick={() => setCategorySearch("")}>
                        Limpar busca
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="sim-category-grid">
                    {visibleCategories.map((category) => (
                      <article key={category.categoryId} className="sim-category-card">
                        {(() => {
                          const useRatingPoints = isRatingCategory(
                            category.categoryName,
                            category.stats?.sortBasis,
                          );
                          const pointsLabel = useRatingPoints ? "Rating" : "Ranking";
                          return (
                            <>
                        <div className="sim-category-card-header">
                          <h3>{category.categoryName}</h3>
                          <ShareActions
                            inline
                            shareText={`Simulação de grupos da categoria ${category.categoryName}`}
                            fileName={`simulador-${eventId}-${category.categoryId}.png`}
                            buildImage={() =>
                              createGroupSimulationShareImageBlob({
                                eventName: event?.nome ?? `Evento ${eventId}`,
                                categoryName: category.categoryName,
                                groups: category.groups.map((group) => ({
                                  groupName: group.groupName,
                                  athletes: group.athletes.map((athlete) => ({
                                    athleteName: athlete.nameReduced || athlete.nameDisplay,
                                    clubName: athlete.clubName ?? "-",
                                  })),
                                })),
                                branding: "PingPong Paid'egua",
                              })
                            }
                          />
                        </div>
                        <p>
                          Atletas Simulados: <strong>{category.registration.considered}</strong> | Inscritos: <strong>{category.registration.confirmed}</strong> | Pré-inscritos: <strong>{category.registration.preInscrito}</strong>
                        </p>
                        <div className="row">
                          <Badge tone="default">
                            Base de seed: {category.stats?.sortBasis === "rating" ? "Rating" : "Ranking"}
                          </Badge>
                          <Badge tone="default">Fallback aplicado: {String(category.stats?.fallbackUsedCount ?? 0)}</Badge>
                          <Badge tone="open">Líder de grupo destacado</Badge>
                        </div>

                        <div className="sim-group-grid">
                          {category.groups.map((group) => (
                            <section key={`${category.categoryId}-${group.groupName}`} className="sim-group-card">
                              <h4>{group.groupName}</h4>
                              <div className="group-athlete-list">
                                <div className="group-athlete-row group-athlete-head">
                                  <span>Atleta</span>
                                  <span>{pointsLabel}</span>
                                </div>
                                {[...group.athletes]
                                  .sort((left, right) => {
                                    const leftPoints = useRatingPoints
                                      ? (left.ratingPoints ?? left.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                                      : (left.rankingPoints ?? left.ratingPoints ?? Number.MIN_SAFE_INTEGER);
                                    const rightPoints = useRatingPoints
                                      ? (right.ratingPoints ?? right.rankingPoints ?? Number.MIN_SAFE_INTEGER)
                                      : (right.rankingPoints ?? right.ratingPoints ?? Number.MIN_SAFE_INTEGER);
                                    if (leftPoints !== rightPoints) {
                                      return rightPoints - leftPoints;
                                    }
                                    return (left.nameReduced || left.nameDisplay).localeCompare(
                                      right.nameReduced || right.nameDisplay,
                                      "pt-BR",
                                      { sensitivity: "base" },
                                    );
                                  })
                                  .map((athlete, athleteIndex) => (
                                  <div
                                    key={`${group.groupName}-${athlete.athleteId}`}
                                    className={`group-athlete-row ${athleteIndex === 0 ? "group-athlete-seed" : ""}`}
                                  >
                                    <div className="group-athlete-main">
                                      <span className="group-athlete-name">
                                        {athleteIndex === 0 ? "★ " : ""}
                                        {athlete.nameReduced || athlete.nameDisplay}
                                      </span>
                                      <span className="group-athlete-club">{athlete.clubName ?? "-"}</span>
                                    </div>
                                    <span className="group-athlete-points">
                                      {useRatingPoints
                                        ? (athlete.ratingPoints ?? "-")
                                        : (athlete.rankingPoints ?? "-")}
                                    </span>
                                  </div>
                                  ))}
                              </div>
                            </section>
                          ))}
                        </div>
                            </>
                          );
                        })()}
                      </article>
                    ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </main>
  );
}
