"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  apiCreateEvent,
  apiDeleteEvent,
  apiGetAdminEvents,
  apiGetAthleteConflicts,
  apiGetEfficiencyConfig,
  apiGetScrapeRuns,
  apiMarkCompleted,
  apiResolveAthleteConflict,
  apiScrapeNow,
  apiUpdateEfficiencyConfig,
  apiUpdateEvent,
  type AdminEventRow,
  type EfficiencyConfig,
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

type ScrapeStage = 1 | 2 | 3;

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
      return "Pré-inscrições";
    case "INSCRICOES_ABERTAS":
      return "Inscrições abertas";
    case "POS_INSCRICOES_PRE_EVENTO":
      return "Pós-inscrições";
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
  const [busyScrapeStage, setBusyScrapeStage] = useState<ScrapeStage | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [scrapeProgressByEvent, setScrapeProgressByEvent] = useState<Record<number, ScrapeProgressState>>({});
  const [efficiencyConfig, setEfficiencyConfig] = useState<EfficiencyConfig | null>(null);
  const [efficiencySaving, setEfficiencySaving] = useState(false);
  const [pesoOuro, setPesoOuro] = useState("400");
  const [pesoPrata, setPesoPrata] = useState("240");
  const [pesoBronze, setPesoBronze] = useState("120");

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
    void loadEfficiencyConfig();
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

  async function loadEfficiencyConfig() {
    try {
      const config = await apiGetEfficiencyConfig();
      setEfficiencyConfig(config);
      setPesoOuro(String(config.pesoOuro));
      setPesoPrata(String(config.pesoPrata));
      setPesoBronze(String(config.pesoBronze));
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao carregar configuração de eficiência.",
      });
    }
  }

  async function saveEfficiencyConfig() {
    const parsedOuro = Number(pesoOuro);
    const parsedPrata = Number(pesoPrata);
    const parsedBronze = Number(pesoBronze);

    if (
      !Number.isInteger(parsedOuro) ||
      !Number.isInteger(parsedPrata) ||
      !Number.isInteger(parsedBronze) ||
      parsedOuro < 0 ||
      parsedPrata < 0 ||
      parsedBronze < 0
    ) {
      setNotice({
        type: "error",
        text: "Pesos inválidos: use inteiros maiores ou iguais a zero.",
      });
      return;
    }

    setEfficiencySaving(true);
    try {
      const saved = await apiUpdateEfficiencyConfig({
        pesoOuro: parsedOuro,
        pesoPrata: parsedPrata,
        pesoBronze: parsedBronze,
      });
      setEfficiencyConfig(saved);
      setNotice({
        type: "success",
        text: "Configuração de eficiência atualizada com sucesso.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao salvar configuração de eficiência.",
      });
    } finally {
      setEfficiencySaving(false);
    }
  }

  async function saveEvent() {
    setNotice(null);

    const parsedCbtmEventId = Number(cbtmEventId);
    if (!Number.isInteger(parsedCbtmEventId) || parsedCbtmEventId < 1) {
      setNotice({
        type: "error",
        text: "Informe um ID CBTM válido.",
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
        invalidFields.push("início inscrições");
      }
      if (fimInscricoes.trim() && !normalizedFimInscricoes) {
        invalidFields.push("fim inscrições");
      }
      if (inicioRealizacao.trim() && !normalizedInicioRealizacao) {
        invalidFields.push("início realização");
      }
      if (fimRealizacao.trim() && !normalizedFimRealizacao) {
        invalidFields.push("fim realização");
      }

      if (invalidFields.length > 0) {
        setNotice({
          type: "error",
          text: `Datas inválidas (${invalidFields.join(", ")}). Use o formato dd/mm/yyyy.`,
        });
        return;
      }
    }

    if (!concluidoForm) {
      const missingFields: string[] = [];
      if (!normalizedInicioInscricoes) {
        missingFields.push("início inscrições");
      }
      if (!normalizedFimInscricoes) {
        missingFields.push("fim inscrições");
      }
      if (!normalizedInicioRealizacao) {
        missingFields.push("início realização");
      }
      if (!normalizedFimRealizacao) {
        missingFields.push("fim realização");
      }

      if (missingFields.length > 0) {
        setNotice({
          type: "error",
          text: `Para evento não concluído, preencha: ${missingFields.join(", ")} (dd/mm/yyyy).`,
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
            ? `Evento criado como concluído. Scrape completo solicitado para '${saved.nome}'.`
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

  async function toggleConcluído(event: EventRow) {
    setNotice(null);
    try {
      if (event.concluido) {
        await apiUpdateEvent(event.id, { concluido: false });
      } else {
        await apiMarkCompleted(event.id);
      }
      setNotice({
        type: "success",
        text: `Evento '${event.nome}' atualizado (${event.concluido ? "reaberto" : "concluído"}).`,
      });
      await refreshEvents({ refreshSelectedDetails: selectedEventId === event.id });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Falha ao atualizar evento.",
      });
    }
  }

  function scrapeStageLabel(stage?: ScrapeStage): string {
    if (stage === 1) {
      return "Etapa 1 (limpeza)";
    }
    if (stage === 2) {
      return "Etapa 2 (categorias e atletas)";
    }
    if (stage === 3) {
      return "Etapa 3 (resultados e eliminatórias)";
    }
    return "Completo";
  }

  async function scrapeNow(event: EventRow, stage?: ScrapeStage) {
    setNotice(null);
    setBusyScrapeEventId(event.id);
    setBusyScrapeStage(stage ?? null);
    try {
      const queued = await apiScrapeNow(event.id, stage);
      const queuedStatus =
        queued && typeof queued === "object"
          ? `${queued.status ?? "queued"}${queued.jobId ? ` (job ${queued.jobId})` : ""}`
          : "queued";

      setNotice({
        type: "success",
        text: `Atualização solicitada para '${event.nome}' [${scrapeStageLabel(stage)}]: ${queuedStatus}.`,
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
        text: error instanceof Error ? error.message : "Falha ao enfileirar atualização.",
      });
    } finally {
      setBusyScrapeEventId(null);
      setBusyScrapeStage(null);
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
    <main className="container grid admin-page">
      <div className="row admin-topbar" style={{ justifyContent: "space-between" }}>
        <h1>Admin</h1>
        <div className="row admin-topbar-actions">
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

      <section className="card grid admin-card">
        <h2>Configuração de Eficiência</h2>
        <div className="row admin-form-row" style={{ flexWrap: "wrap" }}>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Peso Ouro</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step={1}
              value={pesoOuro}
              onChange={(event) => setPesoOuro(event.target.value)}
            />
          </label>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Peso Prata</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step={1}
              value={pesoPrata}
              onChange={(event) => setPesoPrata(event.target.value)}
            />
          </label>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Peso Bronze</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step={1}
              value={pesoBronze}
              onChange={(event) => setPesoBronze(event.target.value)}
            />
          </label>
        </div>
        <div className="row admin-action-row">
          <button className="admin-btn-primary" onClick={saveEfficiencyConfig} disabled={efficiencySaving}>
            {efficiencySaving ? "Salvando..." : "Salvar pesos"}
          </button>
          {efficiencyConfig ? (
            <span className="pill">
              Atual: Ouro {efficiencyConfig.pesoOuro} | Prata {efficiencyConfig.pesoPrata} | Bronze {efficiencyConfig.pesoBronze}
            </span>
          ) : null}
        </div>
      </section>

      <section className="card grid admin-card">
        <h2>{editingEventId ? `Editar evento #${editingEventId}` : "Novo evento monitorado"}</h2>

        <div className="row admin-form-row" style={{ flexWrap: "wrap" }}>
          <input className="admin-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do evento" />
          <input className="admin-input admin-input-id" value={cbtmEventId} onChange={(e) => setCbtmEventId(e.target.value)} placeholder="ID CBTM" />
          <select className="admin-input admin-input-level" value={nivel} onChange={(e) => setNivel((e.target.value as EventLevel) || "")}>
            <option value="">Nível (opcional)</option>
            {EVENT_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <label className="row admin-checkbox-row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={concluidoForm}
              onChange={(event) => setConcluidoForm(event.target.checked)}
            />
            <span>Evento concluído</span>
          </label>
        </div>

        <div className="row admin-form-row" style={{ flexWrap: "wrap" }}>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Início inscrições</span>
            <input
              className="admin-input"
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={inicioInscricoes}
              onChange={(e) => setInicioInscricoes(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Fim inscrições</span>
            <input
              className="admin-input"
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={fimInscricoes}
              onChange={(e) => setFimInscricoes(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Início realização</span>
            <input
              className="admin-input"
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/yyyy"
              value={inicioRealizacao}
              onChange={(e) => setInicioRealizacao(e.target.value)}
              disabled={concluidoForm}
            />
          </label>
          <label className="admin-field" style={{ display: "grid" }}>
            <span>Fim realização</span>
            <input
              className="admin-input"
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
          <p style={{ margin: 0 }}>Evento concluído: datas são opcionais e o scrape será forçado completo.</p>
        ) : (
          <p style={{ margin: 0 }}>Evento não concluído: preencha todas as datas no formato dd/mm/yyyy.</p>
        )}

        <div className="row admin-action-row">
          <button className="admin-btn-primary" onClick={saveEvent} disabled={savingEvent}>
            {savingEvent
              ? "Salvando..."
              : editingEventId
                ? "Salvar alterações"
                : "Criar e iniciar scrape"}
          </button>
          {editingEventId ? (
            <button className="secondary admin-btn-secondary" onClick={resetEventForm}>
              Cancelar edição
            </button>
          ) : null}
        </div>
      </section>

      <section className="card admin-card">
        <h2>Eventos</h2>
        {loading ? <p>Carregando...</p> : null}
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Evento CBTM</th>
              <th>Nome</th>
              <th>Nivel</th>
              <th>Inscrições</th>
              <th>Realização</th>
              <th>Situação</th>
              <th>Status</th>
              <th>Ultimo scrape</th>
              <th>Contagens</th>
              <th>Andamento</th>
              <th>Ações</th>
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
                  <span className="pill">{event.concluido ? "Concluído" : "Ativo"}</span>
                </td>
                <td>{event.lastScrapeAt ? formatDateTimeDisplay(event.lastScrapeAt) : "-"}</td>
                <td>
                  A:{event._count?.athletes ?? 0} C:{event._count?.categories ?? 0} J:{event._count?.matches ?? 0}
                </td>
                <td>
                  {scrapeProgressByEvent[event.id] ? (
                    <span
                      className="pill"
                      title={scrapeProgressByEvent[event.id].message}
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
                <td className="row admin-table-actions" style={{ flexWrap: "wrap" }}>
                  <button className="admin-btn-secondary" onClick={() => loadEventDetails(event.id)}>Detalhes</button>
                  <button className="admin-btn-secondary" onClick={() => startEditEvent(event)}>Editar</button>
                  <div className="row admin-table-actions" style={{ flexWrap: "wrap", gap: 8 }}>
                    <button
                      className="admin-btn-primary"
                      onClick={() => scrapeNow(event)}
                      disabled={busyScrapeEventId === event.id}
                      title="Executa raspagem completa"
                    >
                      {busyScrapeEventId === event.id && busyScrapeStage === null
                        ? "Enfileirando..."
                        : "Raspagem completa"}
                    </button>
                    <button
                      className="admin-btn-secondary"
                      onClick={() => scrapeNow(event, 1)}
                      disabled={busyScrapeEventId === event.id}
                      title="Etapa 1: limpa dados do evento para recarga"
                    >
                      {busyScrapeEventId === event.id && busyScrapeStage === 1
                        ? "Enfileirando..."
                        : "Etapa 1: limpar"}
                    </button>
                    <button
                      className="admin-btn-secondary"
                      onClick={() => scrapeNow(event, 2)}
                      disabled={busyScrapeEventId === event.id}
                      title="Etapa 2: categorias e atletas (inscrições)"
                    >
                      {busyScrapeEventId === event.id && busyScrapeStage === 2
                        ? "Enfileirando..."
                        : "Etapa 2: inscrições"}
                    </button>
                    <button
                      className="admin-btn-secondary"
                      onClick={() => scrapeNow(event, 3)}
                      disabled={busyScrapeEventId === event.id}
                      title="Etapa 3: resultados e eliminatórias"
                    >
                      {busyScrapeEventId === event.id && busyScrapeStage === 3
                        ? "Enfileirando..."
                        : "Etapa 3: resultados"}
                    </button>
                  </div>
                  <button className="secondary admin-btn-secondary" onClick={() => toggleConcluído(event)}>
                    {event.concluido ? "Reabrir" : "Concluir"}
                  </button>
                  <button className="secondary admin-btn-secondary" onClick={() => deleteEvent(event)}>
                    Excluir evento
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="card admin-card">
        <h2>Scrape runs {selectedEvent ? `- ${selectedEvent.nome}` : ""}</h2>
        {selectedEvent ? (
          <p style={{ marginTop: 0 }}>
            Warnings são alertas não fatais gerados durante captura/parser/upsert. Eles indicam
            inconsistencias ou quedas de qualidade sem interromper o scrape.
          </p>
        ) : (
          <p>Selecione um evento para visualizar.</p>
        )}
        <div className="admin-table-wrap">
        <table className="admin-table">
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
        </div>

        {selectedRun ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Warnings do run #{selectedRun.id}</h3>
            {selectedRunWarnings.length === 0 ? (
              <p style={{ margin: 0 }}>Sem warnings neste run.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 8px 0" }}>
                  Total: <strong>{selectedRunWarnings.length}</strong>
                </p>
                <div className="admin-table-wrap">
                <table className="admin-table">
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
                </div>
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

      <section className="card grid admin-card">
        <h2>Conflitos de atleta {selectedEvent ? `- ${selectedEvent.nome}` : ""}</h2>
        {!selectedEvent ? <p>Selecione um evento para listar conflitos.</p> : null}

        <div className="admin-table-wrap">
        <table className="admin-table">
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
                  <td className="row admin-table-actions">
                    {conflict.resolvedAthleteId ? (
                      <span className="pill">Atleta #{conflict.resolvedAthleteId}</span>
                    ) : (
                      <>
                        <select
                          className="admin-input"
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
                        <button className="admin-btn-primary" onClick={() => resolveConflict(conflict)} disabled={candidates.length === 0}>
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
        </div>
      </section>
    </main>
  );
}



