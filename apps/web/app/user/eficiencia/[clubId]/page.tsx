"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ClubEfficiencyCareerPanel } from "../../../../components/user/ClubEfficiencyCareerPanel";
import { Card } from "../../../../components/ui/Card";
import { EmptyState } from "../../../../components/ui/EmptyState";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { apiGetClubEfficiencyCareer, type ClubEfficiencyCareerResponse } from "../../../../lib/user-api";

export default function ClubEfficiencyCareerPage() {
  const router = useRouter();
  const params = useParams<{ clubId: string }>();
  const clubId = Number(params?.clubId ?? "");

  const [data, setData] = useState<ClubEfficiencyCareerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [invalidClubId, setInvalidClubId] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!Number.isFinite(clubId) || clubId <= 0) {
      setData(null);
      setError(false);
      setInvalidClubId(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    setInvalidClubId(false);
    void apiGetClubEfficiencyCareer(clubId)
      .then((response) => {
        setError(false);
        setInvalidClubId(false);
        setData(response);
      })
      .catch(() => {
        setData(null);
        setInvalidClubId(false);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [clubId]);

  return (
    <main className="container grid user-page">
      <PageHeader
        title={(data?.club.name ?? "Eficiência").toUpperCase()}
        subtitle="Eficiência"
        compact
        actions={
          <button type="button" className="event-back-button" onClick={() => router.push("/eficiencia")}>
            ← Voltar
          </button>
        }
      />

      {loading ? (
        <Card className="grid">
          <Skeleton height="52px" />
          <Skeleton height="120px" />
          <Skeleton height="180px" />
        </Card>
      ) : null}

      {!loading && invalidClubId ? (
        <EmptyState title="Clube não encontrado" description="O identificador informado não é válido." />
      ) : null}

      {!loading && error ? (
        <EmptyState
          title="Serviço indisponível"
          description="Não foi possível carregar a eficiência deste clube. Tente novamente em instantes."
        />
      ) : null}

      {!loading && data ? (
        <ClubEfficiencyCareerPanel
          data={data}
          expandedEvents={expandedEvents}
          onToggleEvent={(eventId) =>
            setExpandedEvents((prev) => ({
              ...prev,
              [eventId]: !prev[eventId],
            }))
          }
        />
      ) : null}
    </main>
  );
}
