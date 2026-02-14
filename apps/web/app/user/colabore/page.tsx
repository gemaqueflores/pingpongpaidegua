"use client";

import { useMemo, useState } from "react";

const PIX_QR_DEFAULT = "/pix-qrcode.png";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function ColaborePage() {
  const [amount, setAmount] = useState("20");
  const [showFallback, setShowFallback] = useState(false);

  const numericAmount = useMemo(() => {
    const normalized = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0;
    }
    return normalized;
  }, [amount]);

  const qrCodeUrl = process.env.NEXT_PUBLIC_PIX_QR_CODE_URL || PIX_QR_DEFAULT;

  return (
    <main className="container grid user-page">
      <section className="hero-header">
        <h1 className="hero-title">Colabore com o projeto</h1>
        <p className="hero-subtitle">Contribua com PIX para manter o sistema no ar</p>
      </section>

      <section className="card arena-card grid donate-card">
        <label className="grid" htmlFor="pix-value">
          <span>Valor da colaboração (R$)</span>
          <input
            id="pix-value"
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        <p>
          Valor informado: <strong>{numericAmount > 0 ? formatCurrency(numericAmount) : "-"}</strong>
        </p>

        <div className="pix-qr-wrapper">
          <img
            src={qrCodeUrl}
            alt="QRCode PIX para colaboração"
            className="pix-qr-image"
            onError={() => setShowFallback(true)}
          />
        </div>

        {showFallback ? (
          <p className="warn">
            QRCode PIX não encontrado em <code>{PIX_QR_DEFAULT}</code>. Adicione a imagem no diretório
            <code>apps/web/public</code> ou configure <code>NEXT_PUBLIC_PIX_QR_CODE_URL</code>.
          </p>
        ) : null}

        <p className="arena-muted">
          Após escanear o QRCode no app do banco, informe o valor desejado ({numericAmount > 0 ? formatCurrency(numericAmount) : "editável"}) antes de confirmar o pagamento.
        </p>

        <div className="row">
          <button type="button" onClick={() => (window.location.href = "/")}>Voltar para home</button>
        </div>
      </section>
    </main>
  );
}
