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
  const [categorySlideIndex, setCategorySlideIndex] = useState(0);

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
    setCategorySlideIndex(0);
  }, [scope, response]);

  useEffect(() => {
    if (sortedCategories.length === 0) {
      return;
    }
    if (categorySlideIndex >= sortedCategories.length) {
      setCategorySlideIndex(sortedCategories.length - 1);
    }
  }, [categorySlideIndex, sortedCategories.length]);

  const hasCategories = sortedCategories.length > 0;

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">Simulador de Grupos</h1>
        <p className="hero-subtitle">Arena de projeção de grupos</p>
        <div className="row">
          <button onClick={() => (window.location.href = `/user/events/${eventId}`)}>Voltar ao evento</button>
          <button className="secondary" onClick={() => (window.location.href = "/")}>
            Home
          </button>
        </div>
      </section>

      <section className="card arena-card grid">
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
        {loading ? <p>Carregando simulação...</p> : null}
        {error ? <p className="warn">{error}</p> : null}
        {!loading && !error && response ? (
          <>
            {!hasCategories ? <p>Nenhuma categoria disponível para simulação neste escopo.</p> : null}

            {hasCategories ? (
              <div className="sim-category-carousel">
                <div className="sim-category-carousel-header">
                  <div className="sim-category-tabs" role="tablist" aria-label="Categorias do simulador">
                    {sortedCategories.map((category, index) => (
                      <button
                        key={`tab-${category.categoryId}`}
                        type="button"
                        role="tab"
                        aria-selected={categorySlideIndex === index}
                        className={`sim-category-tab ${categorySlideIndex === index ? "active" : ""}`}
                        onClick={() => setCategorySlideIndex(index)}
                      >
                        {category.categoryName}
                      </button>
                    ))}
                  </div>
                  <p className="sim-category-carousel-counter">
                    Categoria {categorySlideIndex + 1} de {sortedCategories.length}
                  </p>
                </div>

                <div className="sim-category-carousel-viewport">
                  <div
                    className="sim-category-carousel-track"
                    style={{ transform: `translateX(-${categorySlideIndex * 100}%)` }}
                  >
                    {sortedCategories.map((category) => (
                      <article key={category.categoryId} className="sim-category-card sim-category-slide">
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
                            iconOnly
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

                        <div className="sim-group-grid">
                          {category.groups.map((group) => (
                            <section key={`${category.categoryId}-${group.groupName}`} className="sim-group-card">
                              <h4>{group.groupName}</h4>
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>Atleta</th>
                                    <th>Clube</th>
                                    <th>{pointsLabel}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.athletes.map((athlete) => (
                                    <tr key={`${group.groupName}-${athlete.athleteId}`}>
                                      <td>{athlete.nameReduced || athlete.nameDisplay}</td>
                                      <td>{athlete.clubName ?? "-"}</td>
                                      <td>
                                        {useRatingPoints
                                          ? (athlete.ratingPoints ?? "-")
                                          : (athlete.rankingPoints ?? "-")}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
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
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
