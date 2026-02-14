"use client";

import { FormEvent, useState } from "react";
import { apiReportProblem } from "../../../lib/user-api";

export default function ReportarProblemaPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    setError(null);

    try {
      await apiReportProblem({
        title: title.trim(),
        description: description.trim(),
      });
      setMessage("Problema enviado com sucesso. Obrigado pelo reporte.");
      setTitle("");
      setDescription("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao enviar problema.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">Reportar problema</h1>
        <p className="hero-subtitle">Ajude a melhorar o PingPong Paid'egua</p>
      </section>

      <section className="card arena-card grid report-problem-card">
        <form onSubmit={onSubmit} className="grid">
          <label className="grid" htmlFor="bug-title">
            <span>Título</span>
            <input
              id="bug-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Ex.: classificação incorreta na carreira"
              required
            />
          </label>

          <label className="grid" htmlFor="bug-description">
            <span>Descreva o problema</span>
            <textarea
              id="bug-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
              rows={8}
              placeholder="Explique o que aconteceu e em qual tela/atleta/evento."
              required
            />
          </label>

          <div className="row">
            <button type="submit" disabled={sending}>
              {sending ? "Enviando..." : "Enviar problema"}
            </button>
            <button type="button" className="secondary" onClick={() => (window.location.href = "/")}>Voltar</button>
          </div>

          {message ? <p className="support-success">{message}</p> : null}
          {error ? <p className="warn">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
