"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiForgotPassword, apiLogin } from "../../../lib/admin-api";
import { getAuthToken, getUserRole, setAuthToken, setUserRole } from "../../../lib/auth";
import { useEffect } from "react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    if (getUserRole() === "ADMIN" && getAuthToken()) {
      router.push("/admin");
    }
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await apiLogin(username, password);
      setAuthToken(data.accessToken);
      setUserRole("ADMIN");
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  async function onForgotPassword(event: FormEvent) {
    event.preventDefault();
    setForgotLoading(true);
    setForgotMessage(null);
    setError(null);
    try {
      const response = await apiForgotPassword(username || undefined);
      setForgotMessage(
        String(response?.message ?? "Se o e-mail estiver habilitado, voce recebera as instrucoes de reset."),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Falha ao solicitar reset de senha.",
      );
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <main className="container admin-page">
      <div className="card admin-card" style={{ maxWidth: 460, margin: "50px auto" }}>
        <h1>Login Admin</h1>
        <p>Area restrita para administracao</p>

        <form className="grid" onSubmit={onSubmit}>
          <label>
            Usuario
            <input className="admin-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>

          <label>
            Senha
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          <button className="admin-btn-primary" disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
        </form>

        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="secondary admin-btn-secondary" onClick={() => setForgotMode((current) => !current)}>
            Esqueci a senha
          </button>
        </div>

        {forgotMode ? (
          <form className="grid" style={{ marginTop: 12 }} onSubmit={onForgotPassword}>
            <p style={{ margin: 0, color: "#576965" }}>
              O link de reset sera enviado para o e-mail configurado.
            </p>
            <button className="admin-btn-primary" type="submit" disabled={forgotLoading}>
              {forgotLoading ? "Solicitando..." : "Enviar link de reset"}
            </button>
          </form>
        ) : null}

        {forgotMessage ? <p style={{ color: "#0f5132", marginTop: 12 }}>{forgotMessage}</p> : null}
        {error ? <p className="warn">{error}</p> : null}
      </div>
    </main>
  );
}
