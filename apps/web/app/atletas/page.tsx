"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetAthletesDirectory } from "../../lib/user-api";
import { Hero } from "../../components/ui/Hero";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { UserShell } from "../../components/user/UserShell";

type AthleteDirectoryRow = {
  athleteKey: string;
  nameDisplay: string;
  totalEvents: number;
};

const PAGE_SIZE = 30;

export default function AthletesHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [athletes, setAthletes] = useState<AthleteDirectoryRow[]>([]);

  useEffect(() => {
    setLoading(true);
    const timeout = setTimeout(() => {
      void apiGetAthletesDirectory(search)
        .then((rows) => setAthletes(rows as AthleteDirectoryRow[]))
        .catch(() => setAthletes([]))
        .finally(() => setLoading(false));
    }, 220);

    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search]);

  const paged = useMemo(() => athletes.slice(0, visible), [athletes, visible]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <Hero title="Atletas" subtitle="Atletas participantes dos eventos salvos" />

        <Card className="grid" variant="athlete">
          <input
            className="home-athletes-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar atleta por nome"
            aria-label="Buscar atleta por nome"
            autoCapitalize="none"
            autoCorrect="off"
          />

          {loading ? (
            <div className="grid">
              <Skeleton height="60px" />
              <Skeleton height="60px" />
              <Skeleton height="60px" />
            </div>
          ) : (
            <div className="athlete-list-grid">
              {paged.map((athlete) => (
                <article key={athlete.athleteKey} className="athlete-list-card">
                  <div>
                    <h3>{athlete.nameDisplay}</h3>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Badge tone="default">Eventos: {String(athlete.totalEvents)}</Badge>
                    <button onClick={() => router.push(`/career/${encodeURIComponent(athlete.athleteKey)}`)}>
                      Carreira
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && athletes.length === 0 ? (
            <p className="arena-muted">Nenhum atleta encontrado.</p>
          ) : null}

          {!loading && athletes.length > visible ? (
            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={() => setVisible((current) => current + PAGE_SIZE)}>Carregar mais atletas</button>
            </div>
          ) : null}
        </Card>
      </main>
    </UserShell>
  );
}
