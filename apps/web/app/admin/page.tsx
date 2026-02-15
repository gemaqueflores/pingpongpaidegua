"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  apiCreateEvent,
  apiDeleteEvent,
  apiGetAdminEvents,
  apiGetAthleteConflicts,
  apiGetScrapeRuns,
  apiMarkCompleted,
  apiResolveAthleteConflict,
  apiScrapeNow,
  apiUpdateEvent,
  type AdminEventRow,
  type EventLevel,
  type EventSituation,
} from "../../lib/admin-api";
import { clearAuth, getAuthToken, getUserRole } from "../../lib/auth";

type EventRow = AdminEventRow;

type ConflictRow = {
  id: number;
  context: string;
  shortName: string;
  candidateAthletes: {
    candidates?: Array<{ athleteId: number; nameDisplay: string; score: number }>;
  };
  resolvedAthleteId: number | null;
  resolvedAt: string | null;
};

type NoticeState = {
  type: "success" | "error" | "info";
  text: string;
} | null;

type ScrapeProgressState = {
  phase: "queued" | "running" | "done" | "error";
  message: string;
  runId?: number;
};

type ScrapeRunRow = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  warnings: unknown;
  errorMessage: string | null;
};

type WarningSummary = {
  type: string;
  count: number;
};

const EVENT_LEVELS: EventLevel[] = ["ESTADUAL", "COPA", "NACIONAL", "OPEN"];
const EVENT_TIME_ZONE = "America/Sao_Paulo";

function formatEventDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: EVENT_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateInput(value: string | null | undefined): string {
  return formatEventDate(value);
}

function normalizeDateInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!dateRegex.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function formatDateDisplay(value: string | null | undefined): string {
  const formatted = formatEventDate(value);
  return formatted || "-";
}

function formatDateTimeDisplay(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString("pt-BR");
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) {
    return "-";
  }
  return `${formatDateDisplay(start)} -> ${formatDateDisplay(end)}`;
}

function parseWarnings(warnings: unknown): string[] {
  if (Array.isArray(warnings)) {
    return warnings
      .map((warning) => String(warning ?? "").trim())
      .filter(Boolean);
  }

  if (typeof warnings === "string") {
    const trimmed = warnings.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

function warningType(message: string): string {
  const normalized = message.split(":")[0]?.trim() || message.trim();
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
}

function summarizeWarnings(warnings: string[]): WarningSummary[] {
  const countByType = new Map<string, number>();
  for (const warning of warnings) {
    const key = warningType(warning);
    countByType.set(key, (countByType.get(key) ?? 0) + 1);
  }

  return [...countByType.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.type.localeCompare(b.type, "pt-BR", { sensitivity: "base" });
    });
}

function situationLabel(situation: EventSituation | undefined): string {
  switch (situation) {
    case "PRE_INSCRICOES":
      return "Pre-inscricoes";
    case "INSCRICOES_ABERTAS":
      return "Inscricoes abertas";
    case "POS_INSCRICOES_PRE_EVENTO":
      return "Pos-inscricoes";
    case "EM_ANDAMENTO":
      return "Em andamento";
    case "POS_EVENTO":
      return "Pos-evento";
    case "DRAFT":
      return "Draft";
    default:
      return "-";
  }
}

function situationStyle(situation: EventSituation | undefined): { background: string; color: string } {
  switch (situation) {
    case "INSCRICOES_ABERTAS":
      return { background: "#dff6eb", color: "#0f5132" };
    case "EM_ANDAMENTO":
      return { background: "#e7f3ff", color: "#0b4c83" };
    case "POS_EVENTO":
      return { background: "#f0f0f0", color: "#4a4a4a" };
    case "DRAFT":
      return { background: "#fff4d8", color: "#7a5b00" };
    default:
      return { background: "#eef3ff", color: "#1d3d8f" };
  }
}

export default function AdminPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [runs, setRuns] = useState<ScrapeRunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [resolutionByConflict, setResolutionByConflict] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [busyScrapeEventId, setBusyScrapeEventId] = useState<number | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [scrapeProgressByEvent, setScrapeProgressByEvent] = useState<Record<number, ScrapeProgressState>>({});

  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [nome, setNome] = useState("TMB Challenge Plus - Evento 5246");
  const [cbtmEventId, setCbtmEventId] = useState("5246");
  const [nivel, setNivel] = useState<EventLevel | "">("ESTADUAL");
  const [inicioInscricoes, setInicioInscricoes] = useState("");
  const [fimInscricoes, setFimInscricoes] = useState("");
  const [inicioRealizacao, setInicioRealizacao] = useState("");
  const [fimRealizacao, setFimRealizacao] = useState("");
  const [concluidoForm, setConcluidoForm] = useState(false);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

  const selectedRunWarnings = useMemo(() => parseWarnings(selectedRun?.warnings), [selectedRun?.warnings]);
  const selectedRunWarningSummary = useMemo(
    () => summarizeWarnings(selectedRunWarnings),
    [selectedRunWarnings],
  );

  useEffect(() => {
    if (getUserRole() !== "ADMIN" || !getAuthToken()) {
      router.push("/admin/login");
      return;
    }

    void refreshEvents();
  }, [router]);

  function resetEventForm() {
    setEditingEventId(null);
    setNome("TMB Challenge Plus - Evento 5246");
    setCbtmEventId("5246");
    setNivel("ESTADUAL");
    setInicioInscricoes("");
    setFimInscricoes("");
    setInicioRealizacao("");
    setFimRealizacao("");
    setConcluidoForm(false);
  }

  function startEditEvent(event: EventRow) {
    setEditingEventId(event.id);
    setNome(event.nome);
    setCbtmEventId(String(event.cbtmEventId));
    setNivel(event.nivel ?? "");
    setInicioInscricoes(formatDateInput(event.inicioInscricoes));
    setFimInscricoes(formatDateInput(event.fimInscricoes));
    setInicioRealizacao(formatDateInput(event.inicioRealizacao ?? event.dataInicio));
    setFimRealizacao(formatDateInput(event.fimRealizacao ?? event.dataFim));
    setConcluidoForm(Boolean(event.concluido));
  }

  function setScrapeProgress(eventId: number, next: ScrapeProgressState | null) {
    setScrapeProgressByEvent((previous) => {
      const copy = { ...previous };
      if (!next) {
        delete copy[eventId];
      } else {
        copy[eventId] = next;
      }
      return copy;
    });
  }

  async function trackScrapeProgress(eventId: number, baselineStartedAtIso?: string) {
    const baseline = baselineStartedAtIso ? new Date(baselineStartedAtIso).getTime() : Date.now();

    setScrapeProgress(eventId, {
      phase: "queued",
      message: "Scrape enfileirado...",
    });

    const maxAttempts = 180;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const runData = await apiGetScrapeRuns(eventId);
        const latest = Array.isArray(runData) ? runData[0] : null;
        const startedAtMs = latest?.startedAt ? new Date(latest.startedAt).getTime() : 0;
        const isCurrentRun = Boolean(latest && startedAtMs >= baseline - 10_000);

        if (!latest || !isCurrentRun) {
          setScrapeProgress(eventId, {
            phase: "queued",
            message: "Aguardando inicio do scrape...",
          });
        } else if (!latest.finishedAt) {
          setScrapeProgress(eventId, {
            phase: "running",
            runId: latest.id,
            message: `Extraindo dados... (run #${latest.id})`,
          });
        } else {
          const status = String(latest.status ?? "PARTIAL").toUpperCase();
          const isError = status === "ERROR";
          setScrapeProgress(eventId, {
            phase: isError ? "error" : "done",
            runId: latest.id,
            message: isError
              ? `Finalizado com erro (run #${latest.id})`
              : `Finalizado (${status}) (run #${latest.id})`,
          });

          await refreshEvents({ refreshSelectedDetails: false });
          if (selectedEventId === eventId) {
            await loadEventDetails(eventId);
          }
          return;
        }
      } catch {
        setScrapeProgress(eventId, {
          phase: "error",
          message: "Falha ao consultar andamento do scrape.",
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    setScrapeProgress(eventId, {
      phase: "error",
      message: "Tempo de acompanhamento excedido. Veja os scrape runs.",
    });
  }

  async function refreshEvents(options?: { refreshSelectedDetails?: boolean }) {
    setLoading(true);
    try {
      const data = await apiGetAdminEvents();
      setEvents(data);

      if (options?.refreshSelectedDetails && selectedEventId) {
        await loadEventDetails(selectedEventId);
      }
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao carregar eventos.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveEvent() {
    setNotice(null);

    const parsedCbtmEventId = Number(cbtmEventId);
    if (!Number.isInteger(parsedCbtmEventId) || parsedCbtmEventId < 1) {
      setNotice({
        type: "error",
        text: "Informe um ID CBTM valido.",
      });
      return;
    }

    if (!nome.trim()) {
      setNotice({
        type: "error",
        text: "Informe o nome do evento.",
      });
      return;
    }

    const normalizedInicioInscricoes = normalizeDateInput(inicioInscricoes);
    const normalizedFimInscricoes = normalizeDateInput(fimInscricoes);
    const normalizedInicioRealizacao = normalizeDateInput(inicioRealizacao);
    const normalizedFimRealizacao = normalizeDateInput(fimRealizacao);

    const hasAnyDateInput =
      Boolean(inicioInscricoes.trim()) ||
      Boolean(fimInscricoes.trim()) ||
      Boolean(inicioRealizacao.trim()) ||
      Boolean(fimRealizacao.trim());

    if (hasAnyDateInput) {
      const invalidFields: string[] = [];
      if (inicioInscricoes.trim() && !normalizedInicioInscricoes) {
        invalidFields.push("inicio inscricoes");
      }
      if (fimInscricoes.trim() && !normalizedFimInscricoes) {
        invalidFields.push("fim inscricoes");
      }
      if (inicioRealizacao.trim() && !normalizedInicioRealizacao) {
        invalidFields.push("inicio realizacao");
      }
      if (fimRealizacao.trim() && !normalizedFimRealizacao) {
        invalidFields.push("fim realizacao");
      }

      if (invalidFields.length > 0) {
        setNotice({
          type: "error",
          text: `Datas invalidas (${invalidFields.join(", ")}). Use o formato dd/mm/yyyy.`,
        });
        return;
      }
    }

    if (!concluidoForm) {
      const missingFields: string[] = [];
      if (!normalizedInicioInscricoes) {
        missingFields.push("inicio inscricoes");
      }
      if (!normalizedFimInscricoes) {
        missingFields.push("fim inscricoes");
      }
      if (!normalizedInicioRealizacao) {
        missingFields.push("inicio realizacao");
      }
      if (!normalizedFimRealizacao) {
        missingFields.push("fim realizacao");
      }

      if (missingFields.length > 0) {
        setNotice({
          type: "error",
          text: `Para evento nao concluido, preencha: ${missingFields.join(", ")} (dd/mm/yyyy).`,
        });
        return;
      }
    }

    setSavingEvent(true);
    try {
      const payload = {
        nome: nome.trim(),
        cbtmEventId: parsedCbtmEventId,
        nivel: nivel || undefined,
        inicioInscricoes: normalizedInicioInscricoes,
        fimInscricoes: normalizedFimInscricoes,
        inicioRealizacao: normalizedInicioRealizacao,
        fimRealizacao: normalizedFimRealizacao,
        concluido: concluidoForm,
      };

      const saved = editingEventId
        ? await apiUpdateEvent(editingEventId, payload)
        : await apiCreateEvent(payload);

      setNotice({
        type: "success",
        text: editingEventId
          ? `Evento '${saved.nome}' atualizado.`
          : concluidoForm
            ? `Evento criado como concluido. Scrape completo solicitado para '${saved.nome}'.`
            : `Evento criado com sucesso. Scrape solicitado para '${saved.nome}'.`,
      });

      await refreshEvents({ refreshSelectedDetails: false });
      if (saved?.id) {
        setSelectedEventId(saved.id);
        await loadEventDetails(saved.id);
        void trackScrapeProgress(saved.id);
      }
      resetEventForm();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao salvar evento.",
      });
    } finally {
      setSavingEvent(false);
    }
  }

  async function toggleConcluido(event: EventRow) {
    setNotice(null);
    try {
      if (event.concluido) {
        await apiUpdateEvent(event.id, { concluido: false });
      } else {
        await apiMarkCompleted(event.id);
      }
      setNotice({
        type: "success",
        text: `Evento '${event.nome}' atualizado (${event.concluido ? "reaberto" : "concluido"}).`,
      });
      await refreshEvents({ refreshSelectedDetails: selectedEventId === event.id });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao atualizar evento.",
      });
    }
  }

  async function scrapeNow(event: EventRow) {
    setNotice(null);
    setBusyScrapeEventId(event.id);
    try {
      const queued = await apiScrapeNow(event.id);
      const queuedStatus =
        queued && typeof queued === "object"
          ? `${queued.status ?? "queued"}${queued.jobId ? ` (job ${queued.jobId})` : ""}`
          : "queued";

      setNotice({
        type: "success",
        text: `Atualizacao solicitada para '${event.nome}': ${queuedStatus}.`,
      });
      const queuedAt = new Date().toISOString();
      void trackScrapeProgress(event.id, queuedAt);

      await refreshEvents({ refreshSelectedDetails: selectedEventId === event.id });
      if (selectedEventId === event.id) {
        await loadEventDetails(event.id);
      }
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao enfileirar atualizacao.",
      });
    } finally {
      setBusyScrapeEventId(null);
    }
  }

  async function deleteEvent(event: EventRow) {
    const ok = window.confirm(`Excluir o evento '${event.nome}' e todos os dados vinculados?`);
    if (!ok) {
      return;
    }

    setNotice(null);
    try {
      await apiDeleteEvent(event.id);
      if (selectedEventId === event.id) {
        setSelectedEventId(null);
        setRuns([]);
        setConflicts([]);
        setSelectedRunId(null);
      }
      setNotice({ type: "success", text: `Evento '${event.nome}' excluido.` });
      await refreshEvents({ refreshSelectedDetails: false });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao excluir evento.",
      });
    }
  }

  async function loadEventDetails(eventId: number) {
    setSelectedEventId(eventId);
    const [runData, conflictData] = await Promise.all([
      apiGetScrapeRuns(eventId),
      apiGetAthleteConflicts(eventId),
    ]);

    const nextRuns = Array.isArray(runData) ? (runData as ScrapeRunRow[]) : [];
    setRuns(nextRuns);
    setSelectedRunId((current) => {
      if (nextRuns.length === 0) {
        return null;
      }
      if (current && nextRuns.some((run) => run.id === current)) {
        return current;
      }
      return nextRuns[0].id;
    });

    const nextConflicts = Array.isArray(conflictData) ? (conflictData as ConflictRow[]) : [];
    setConflicts(nextConflicts);

    const defaults: Record<number, number> = {};
    for (const conflict of nextConflicts) {
      const candidates = conflict.candidateAthletes?.candidates ?? [];
      if (candidates.length > 0) {
        defaults[conflict.id] = candidates[0].athleteId;
      }
    }
    setResolutionByConflict(defaults);
  }

  async function resolveConflict(conflict: ConflictRow) {
    if (!selectedEventId) {
      return;
    }

    const athleteId = resolutionByConflict[conflict.id];
    if (!athleteId) {
      return;
    }

    setNotice(null);
    try {
      await apiResolveAthleteConflict(selectedEventId, conflict.id, athleteId);
      setNotice({ type: "success", text: `Conflito #${conflict.id} resolvido.` });
      await refreshEvents({ refreshSelectedDetails: false });
      await loadEventDetails(selectedEventId);
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao resolver conflito.",
      });
    }
  }

  return (
    <main className="container grid">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Admin</h1>
        <div className="row">
          <button
            className="secondary"
            onClick={() => {
              clearAuth();
              router.push("/admin/login");
            }}
          >
            Sair
          </button>
        </div>
      </div>

      {notice ? (
        <section
          className="card"
          style={{
            borderColor: notice.type === "error" ? "#cc4b37" : undefined,
            background:
              notice.type === "error"
                ? "#fff0ed"
                : notice.type === "success"
                  ? "#eef9f4"
                  : "#f2f7ff",
          }}
        >
          <p
            style={{
              margin: 0,
              color: notice.type === "error" ? "#8a2b00" : "#23433d",
              fontWeight: 600,
            }}
          >
            {notice.text}
          </p>
        </section>
      ) : null}

      <section className="card grid">
        <h2>{editingEventId ? `Editar evento #${editingEventId}` : "Novo evento monitorado"}</h2>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do evento" />
          <input value={cbtmEventId} onChange={(e) => setCbtmEventId(e.target.value)} placeholder="ID CBTM" />
          <select value={nivel} onChange={(e) => setNivel((e.target.value as EventLevel) || "")}>
            <option value="">Nivel (opcional)</option>
            {EVENT_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={concluidoForm}
              onChange={(event) => setConcluidoForm(event.target.checked)}
            />
            <span>Evento concluido</span>
          </label>
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <label style={{ display: "grid" }}>
            <span>Inicio inscricoes</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={inicioInscricoes}
              onChange={(e) => setInicioInscricoes(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label style={{ display: "grid" }}>
            <span>Fim inscricoes</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={fimInscricoes}
              onChange={(e) => setFimInscricoes(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label style={{ display: "grid" }}>
            <span>Inicio realizacao</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={inicioRealizacao}
              onChange={(e) => setInicioRealizacao(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label style={{ display: "grid" }}>
            <span>Fim realizacao</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={fimRealizacao}
              onChange={(e) => setFimRealizacao(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
        </div>

        {concluidoForm ? (
          <p style={{ margin: 0 }}>Evento concluido: datas sao opcionais e o scrape sera forcado completo.</p>
        ) : (
          <p style={{ margin: 0 }}>Evento nao concluido: preencha todas as datas no formato dd/mm/yyyy.</p>
        )}

        <div className="row">
          <button onClick={saveEvent} disabled={savingEvent}>
            {savingEvent
              ? "Salvando..."
              : editingEventId
                ? "Salvar alteracoes"
                : "Criar e iniciar scrape"}
          </button>
          {editingEventId ? (
            <button className="secondary" onClick={resetEventForm}>
              Cancelar edicao
            </button>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Eventos</h2>
        {loading ? <p>Carregando...</p> : null}
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Evento CBTM</th>
              <th>Nome</th>
              <th>Nivel</th>
              <th>Inscricoes</th>
              <th>Realizacao</th>
              <th>Situacao</th>
              <th>Status</th>
              <th>Ultimo scrape</th>
              <th>Contagens</th>
              <th>Andamento</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.id}</td>
                <td>{event.cbtmEventId}</td>
                <td>{event.nome}</td>
                <td>{event.nivel ?? "-"}</td>
                <td>{formatPeriod(event.inicioInscricoes, event.fimInscricoes)}</td>
                <td>{formatPeriod(event.inicioRealizacao ?? event.dataInicio, event.fimRealizacao ?? event.dataFim)}</td>
                <td>
                  <span className="pill" style={situationStyle(event.situacaoComputada)}>
                    {situationLabel(event.situacaoComputada)}
                  </span>
                  {event.proximaMudanca ? (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      Prox: {formatDateTimeDisplay(event.proximaMudanca)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className="pill">{event.concluido ? "Concluido" : "Ativo"}</span>
                </td>
                <td>{event.lastScrapeAt ? formatDateTimeDisplay(event.lastScrapeAt) : "-"}</td>
                <td>
                  A:{event._count?.athletes ?? 0} C:{event._count?.categories ?? 0} J:{event._count?.matches ?? 0}
                </td>
                <td>
                  {scrapeProgressByEvent[event.id] ? (
                    <span
                      className="pill"
                      style={{
                        background:
                          scrapeProgressByEvent[event.id].phase === "error"
                            ? "#ffe5df"
                            : scrapeProgressByEvent[event.id].phase === "running"
                              ? "#e7f3ff"
                              : "#dcefea",
                        color:
                          scrapeProgressByEvent[event.id].phase === "error"
                            ? "#8a2b00"
                            : scrapeProgressByEvent[event.id].phase === "running"
                              ? "#0b4c83"
                              : "#0b4f45",
                      }}
                    >
                      {scrapeProgressByEvent[event.id].message}
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="row" style={{ flexWrap: "wrap" }}>
                  <button onClick={() => loadEventDetails(event.id)}>Detalhes</button>
                  <button onClick={() => startEditEvent(event)}>Editar</button>
                  <button onClick={() => scrapeNow(event)} disabled={busyScrapeEventId === event.id}>
                    {busyScrapeEventId === event.id ? "Enfileirando..." : "Atualizar agora"}
                  </button>
                  <button className="secondary" onClick={() => toggleConcluido(event)}>
                    {event.concluido ? "Reabrir" : "Concluir"}
                  </button>
                  <button className="secondary" onClick={() => deleteEvent(event)}>
                    Excluir evento
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Scrape runs {selectedEvent ? `- ${selectedEvent.nome}` : ""}</h2>
        {selectedEvent ? (
          <p style={{ marginTop: 0 }}>
            Warnings sao alertas nao fatais gerados durante captura/parser/upsert. Eles indicam
            inconsistencias ou quedas de qualidade sem interromper o scrape.
          </p>
        ) : (
          <p>Selecione um evento para visualizar.</p>
        )}
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Inicio</th>
              <th>Fim</th>
              <th>Status</th>
              <th>Warnings</th>
              <th>Erro</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                style={{
                  background: selectedRunId === run.id ? "#f2f7ff" : undefined,
                  cursor: "pointer",
                }}
                onClick={() => setSelectedRunId(run.id)}
              >
                <td>{run.id}</td>
                <td>{new Date(run.startedAt).toLocaleString("pt-BR")}</td>
                <td>{run.finishedAt ? new Date(run.finishedAt).toLocaleString("pt-BR") : "-"}</td>
                <td>{run.status}</td>
                <td>{parseWarnings(run.warnings).length}</td>
                <td>{run.errorMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {selectedRun ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Warnings do run #{selectedRun.id}</h3>
            {selectedRunWarnings.length === 0 ? (
              <p style={{ margin: 0 }}>Sem warnings nesse run.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 8px 0" }}>
                  Total: <strong>{selectedRunWarnings.length}</strong>
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Qtd.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRunWarningSummary.map((item) => (
                      <tr key={item.type}>
                        <td>{item.type}</td>
                        <td>{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details style={{ marginTop: 8 }}>
                  <summary>Mensagens completas</summary>
                  <ul>
                    {selectedRunWarnings.map((warning, index) => (
                      <li key={`${selectedRun.id}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section className="card grid">
        <h2>Conflitos de atleta {selectedEvent ? `- ${selectedEvent.nome}` : ""}</h2>
        {!selectedEvent ? <p>Selecione um evento para listar conflitos.</p> : null}

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Contexto</th>
              <th>Nome curto</th>
              <th>Candidatos</th>
              <th>Status</th>
              <th>Resolver</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict) => {
              const candidates = conflict.candidateAthletes?.candidates ?? [];
              const selectedAthlete = resolutionByConflict[conflict.id] ?? 0;

              return (
                <tr key={conflict.id}>
                  <td>{conflict.id}</td>
                  <td>{conflict.context}</td>
                  <td>{conflict.shortName}</td>
                  <td>
                    {candidates.length === 0
                      ? "Sem candidatos"
                      : candidates.map((candidate) => `${candidate.nameDisplay} (${candidate.score})`).join(" | ")}
                  </td>
                  <td>{conflict.resolvedAthleteId ? "Resolvido" : "Pendente"}</td>
                  <td className="row">
                    {conflict.resolvedAthleteId ? (
                      <span className="pill">Atleta #{conflict.resolvedAthleteId}</span>
                    ) : (
                      <>
                        <select
                          value={selectedAthlete}
                          onChange={(event) =>
                            setResolutionByConflict((previous) => ({
                              ...previous,
                              [conflict.id]: Number(event.target.value),
                            }))
                          }
                        >
                          {candidates.map((candidate) => (
                            <option key={candidate.athleteId} value={candidate.athleteId}>
                              {candidate.nameDisplay}
                            </option>
                          ))}
                        </select>
                        <button onClick={() => resolveConflict(conflict)} disabled={candidates.length === 0}>
                          Resolver
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
