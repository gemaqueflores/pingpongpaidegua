"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetGlobalEfficiency, type EventEfficiencyRow, type GlobalEfficiencyResponse } from "../../lib/user-api";
import { Hero } from "../../components/ui/Hero";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { UserShell } from "../../components/user/UserShell";

function formatClubMedalBadge(row: EventEfficiencyRow): string {
  return `🥇${row.ouro} 🥈${row.prata} 🥉${row.bronze} (${row.totalQuantidade})`;
}

export default function EfficiencyHubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [data, setData] = useState<GlobalEfficiencyResponse | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiGetGlobalEfficiency()
      .then((result) => setData(result))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const rows = data?.ranking ?? [];
    const query = search.trim().toUpperCase();
    if (!query) return rows;
    return rows.filter((row) => row.clubName.toUpperCase().includes(query));
  }, [data?.ranking, search]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <Hero title="Eficiência" subtitle="Clubes contidos na base" />

        <Card className="grid" variant="event">
          <input
            className="home-athletes-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar clube"
            aria-label="Buscar clube"
            autoCapitalize="none"
            autoCorrect="off"
          />

          {loading ? (
            <div className="athlete-list-grid">
              <Skeleton height="60px" />
              <Skeleton height="60px" />
              <Skeleton height="60px" />
            </div>
          ) : (
            <div className="athlete-list-grid">
              {filtered.map((club) => (
                <article key={club.clubId} className="athlete-list-card">
                  <div>
                    <h3>{club.clubName}</h3>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <Badge tone="default">{formatClubMedalBadge(club)}</Badge>
                    <button onClick={() => router.push(`/eficiencia/${club.clubId}`)}>Ver detalhes</button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 ? (
            <p className="arena-muted">Nenhum clube encontrado na eficiência consolidada.</p>
          ) : null}
        </Card>
      </main>
    </UserShell>
  );
}
