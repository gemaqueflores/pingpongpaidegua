"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiResetPassword } from "../../../lib/admin-api";

export function AdminResetPasswordClient() {
  const params = useSearchParams();
  const token = useMemo(() => params.get("token") ?? "", [params]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!token) {
      setError("Token de reset ausente.");
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setLoading(true);
    try {
      await apiResetPassword(token, password);
      setMessage("Senha redefinida com sucesso. Volte ao login para entrar.");
      setPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Falha ao redefinir senha.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <div className="card" style={{ maxWidth: 460, margin: "50px auto" }}>
        <h1>Reset de Senha</h1>
        <p>Informe a nova senha para concluir o reset.</p>

        <form className="grid" onSubmit={onSubmit}>
          <label>
            Nova senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <label>
            Confirmar nova senha
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <button disabled={loading}>{loading ? "Salvando..." : "Salvar nova senha"}</button>
        </form>

        <p style={{ marginTop: 12 }}>
          <a href="/admin/login">Voltar para login</a>
        </p>

        {message ? <p style={{ color: "#0f5132" }}>{message}</p> : null}
        {error ? <p className="warn">{error}</p> : null}
      </div>
    </main>
  );
}

