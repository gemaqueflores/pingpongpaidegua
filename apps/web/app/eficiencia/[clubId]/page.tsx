"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ClubEfficiencyCareerPanel } from "../../../components/user/ClubEfficiencyCareerPanel";
import { UserShell } from "../../../components/user/UserShell";
import { Card } from "../../../components/ui/Card";
import { Hero } from "../../../components/ui/Hero";
import { Skeleton } from "../../../components/ui/Skeleton";
import { apiGetClubEfficiencyCareer, type ClubEfficiencyCareerResponse } from "../../../lib/user-api";

export default function EficienciaClubeCanonicalPage() {
  const router = useRouter();
  const params = useParams<{ clubId: string }>();
  const clubId = Number(params?.clubId ?? "");

  const [data, setData] = useState<ClubEfficiencyCareerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!Number.isFinite(clubId) || clubId <= 0) {
      setError("Clube inválido.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void apiGetClubEfficiencyCareer(clubId)
      .then((response) => setData(response))
      .catch((err: unknown) => {
        setData(null);
        setError(err instanceof Error ? err.message : "Falha ao carregar eficiência do clube.");
      })
      .finally(() => setLoading(false));
  }, [clubId]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <Hero
          title={(data?.club.name ?? "Eficiência").toUpperCase()}
          subtitle="Eficiência"
          actions={<button onClick={() => router.push("/")}>Voltar para home</button>}
        />

        {loading ? (
          <Card className="grid">
            <Skeleton height="52px" />
            <Skeleton height="120px" />
            <Skeleton height="180px" />
          </Card>
        ) : null}

        {!loading && error ? (
          <Card className="grid">
            <p>{error}</p>
          </Card>
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
    </UserShell>
  );
}
