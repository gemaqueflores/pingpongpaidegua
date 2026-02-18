"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetGlobalEfficiency, type EventEfficiencyRow, type GlobalEfficiencyResponse } from "../../lib/user-api";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { UserShell } from "../../components/user/UserShell";
import { SearchInput } from "../../components/ui/SearchInput";
import { EmptyState } from "../../components/ui/EmptyState";

function formatClubMedalBadge(row: EventEfficiencyRow): string {
  return `🥇${row.ouro} 🥈${row.prata} 🥉${row.bronze} (${row.totalQuantidade})`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR");
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
    const rows = [...(data?.ranking ?? [])].sort((left, right) => {
      if (right.ouro !== left.ouro) {
        return right.ouro - left.ouro;
      }
      if (right.prata !== left.prata) {
        return right.prata - left.prata;
      }
      if (right.bronze !== left.bronze) {
        return right.bronze - left.bronze;
      }
      if (right.totalQuantidade !== left.totalQuantidade) {
        return right.totalQuantidade - left.totalQuantidade;
      }
      return left.clubName.localeCompare(right.clubName, "pt-BR");
    });
    const query = search.trim().toUpperCase();
    if (!query) return rows;
    return rows.filter((row) => row.clubName.toUpperCase().includes(query));
  }, [data?.ranking, search]);

  return (
    <UserShell>
      <main className="container grid user-page">
        <PageHeader title="Eficiência" subtitle="Clubes contidos na base" compact className="eficiencia-page-header" />

        <Card className="grid" variant="event">
          <p className="efficiency-page-kicker">Ranking geral por medalhas</p>
          <p className="arena-muted efficiency-page-period">Período considerado: todos os eventos computados na base.</p>

          <SearchInput
            value={search}
            onDebouncedChange={setSearch}
            placeholder="Buscar clube"
            ariaLabel="Buscar clube"
            stickyClassName="eficiencia-search-sticky"
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
                    <p className="efficiency-club-total">
                      Total: <strong>{formatNumber(club.totalQuantidade)}</strong>
                    </p>
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
            <EmptyState
              title="Nenhum clube encontrado"
              description="Tente um termo diferente para localizar clubes na eficiência consolidada."
            />
          ) : null}
        </Card>
      </main>
    </UserShell>
  );
}

