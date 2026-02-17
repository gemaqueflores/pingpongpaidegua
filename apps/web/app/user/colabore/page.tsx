"use client";

import { useMemo, useState } from "react";
import { Hero } from "../../../components/ui/Hero";
import { Card } from "../../../components/ui/Card";

const PIX_QR_DEFAULT = "/pix-qrcode.png";
const PIX_KEY_DEFAULT = "227b600a-3d60-4229-90c8-3286d822b6ae";
const PIX_MERCHANT_NAME_DEFAULT = "LEONARDO MURILO GEMAQUE FLORES";
const PIX_MERCHANT_CITY_DEFAULT = "MARABA";

function normalizePixText(value: string, maxLength: number): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, "")
    .slice(0, maxLength);
}

function tlv(id: string, value: string): string {
  const size = String(value.length).padStart(2, "0");
  return `${id}${size}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixPayload(pixKey: string, merchantName: string, merchantCity: string): string {
  const merchantAccount = `${tlv("00", "br.gov.bcb.pix")}${tlv("01", pixKey)}`;
  const data =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("58", "BR") +
    tlv("59", normalizePixText(merchantName, 25)) +
    tlv("60", normalizePixText(merchantCity, 15)) +
    tlv("62", tlv("05", "***")) +
    "6304";

  return `${data}${crc16(data)}`;
}

export default function ColaborePage() {
  const [showFallback, setShowFallback] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pixKey = process.env.NEXT_PUBLIC_PIX_KEY || PIX_KEY_DEFAULT;
  const merchantName = process.env.NEXT_PUBLIC_PIX_MERCHANT_NAME || PIX_MERCHANT_NAME_DEFAULT;
  const merchantCity = process.env.NEXT_PUBLIC_PIX_MERCHANT_CITY || PIX_MERCHANT_CITY_DEFAULT;

  const pixPayload = useMemo(() => buildPixPayload(pixKey, merchantName, merchantCity), [pixKey, merchantName, merchantCity]);
  const pixQrFromPayload = useMemo(() => `/api/pix-qrcode?data=${encodeURIComponent(pixPayload)}`, [pixPayload]);

  const qrCodeUrl = process.env.NEXT_PUBLIC_PIX_QR_CODE_URL || pixQrFromPayload || PIX_QR_DEFAULT;

  const handleCopyPixKey = async () => {
    try {
      await navigator.clipboard.writeText(pixKey);
      setCopySuccess(true);
      setToast("Chave PIX copiada.");
      setTimeout(() => setCopySuccess(false), 2500);
      setTimeout(() => setToast(null), 2500);
    } catch {
      setCopySuccess(false);
    }
  };

  return (
    <main className="container grid user-page">
      <Hero
        title="Apoie o projeto"
        subtitle="Contribua com PIX para manter o sistema no ar"
      />

      <Card className="grid donate-card">
        <p className="arena-muted">
          Seu apoio ajuda a manter a infraestrutura, scraping e recursos de compartilhamento.
        </p>

        <div className="pix-qr-wrapper">
          <img
            src={qrCodeUrl}
            alt="QRCode PIX para apoio"
            className="pix-qr-image"
            loading="lazy"
            decoding="async"
            onError={() => setShowFallback(true)}
          />
        </div>

        <div className="row">
          <button type="button" className="secondary" onClick={handleCopyPixKey}>
            Copiar chave PIX
          </button>
          {copySuccess ? <span className="arena-muted">Chave copiada.</span> : null}
        </div>

        <p className="arena-muted">
          Chave PIX: <strong>{pixKey}</strong>
        </p>

        {showFallback ? (
          <p className="warn">
            QRCode PIX indisponivel. Adicione a imagem no diretorio
            <code>apps/web/public</code> ou configure <code>NEXT_PUBLIC_PIX_QR_CODE_URL</code>.
          </p>
        ) : null}

        <p className="arena-muted">
          Apos escanear o QRCode no app do banco, informe o valor diretamente no aplicativo bancario antes de confirmar o pagamento.
        </p>

        <div className="row">
          <button type="button" className="event-back-button" onClick={() => (window.location.href = "/")}>
            ← Voltar
          </button>
        </div>
        {toast ? <div className="ui-toast">{toast}</div> : null}
      </Card>
    </main>
  );
}

