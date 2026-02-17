"use client";

import React from "react";
import { useState } from "react";
import { downloadBlob } from "../../lib/share-image";

interface ShareActionsProps {
  shareText: string;
  fileName: string;
  buildImage: () => Promise<Blob>;
  inline?: boolean;
  iconOnly?: boolean;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 448 512" aria-hidden className="share-svg-icon">
      <path
        fill="currentColor"
        d="M380.9 97.1C339-6.1 214.3-39.3 129.4 45.6c-59 59-75.2 148.8-43.5 224.3L64 448l182.9-21.5c74.1 28.5 159.4 9.1 212.3-43.8 85-84.9 51.7-209.6-52.3-251.6zM229.5 388.2c-33.7 0-66.6-9.1-95.2-26.3l-6.8-4-108.5 12.7 13-106.1-4.4-7c-18.4-29.2-28.1-62.9-28.1-97.5 0-100.9 82.1-183 183-183 49 0 95.1 19.1 129.8 53.8 71.5 71.5 71.5 188.1 0 259.6-35.4 35.4-82.4 54.8-132.8 54.8zm100.4-138.2c-5.5-2.7-32.5-16-37.6-17.8s-8.9-2.7-12.6 2.7c-3.8 5.5-14.4 17.8-17.7 21.5-3.3 3.8-6.5 4.1-12 .9-32.6-16.3-54-29.1-75.5-66.1-5.7-9.8 5.7-9.1 16.3-30.2 1.8-3.8.9-7.1-.5-9.8s-12.6-30.4-17.2-41.6c-4.5-10.8-9.1-9.3-12.6-9.5-3.3-.1-7.1-.2-10.9-.2s-9.8 1.4-15 7.1-19.7 19.3-19.7 47.1 20.2 54.6 23 58.3c2.7 3.8 39.8 60.8 96.4 85.2 35.7 15.4 49.7 16.7 67.6 14.1 10.9-1.6 32.5-13.3 37.1-26.2 4.5-12.8 4.5-23.8 3.2-26.1-1.2-2.2-4.9-3.5-10.4-6.2z"
      />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 448 512" aria-hidden className="share-svg-icon">
      <path
        fill="currentColor"
        d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.2 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.5 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.9-26.9 26.9-14.9 0-26.9-12-26.9-26.9 0-14.9 12-26.9 26.9-26.9 14.9 0 26.9 12 26.9 26.9zm76.1 27.3c-1.7-35.7-9.8-67.3-35.9-93.3S353.1 36 317.4 34.3c-36-2-143.9-2-179.9 0-35.7 1.7-67.3 9.8-93.3 35.9S6.2 127.5 4.5 163.2c-2 36-2 143.9 0 179.9 1.7 35.7 9.8 67.3 35.9 93.3s57.6 34.2 93.3 35.9c36 2 143.9 2 179.9 0 35.7-1.7 67.3-9.8 93.3-35.9 26.1-26.1 34.2-57.6 35.9-93.3 2-36 2-143.9 0-179.9zM398 388c-7.8 19.6-22.9 34.7-42.5 42.5-29.4 11.6-99.1 8.9-131.4 8.9s-102.1 2.6-131.4-8.9c-19.6-7.8-34.7-22.9-42.5-42.5-11.6-29.4-8.9-99.1-8.9-131.4s-2.6-102.1 8.9-131.4c7.8-19.6 22.9-34.7 42.5-42.5 29.4-11.6 99.1-8.9 131.4-8.9s102.1-2.6 131.4 8.9c19.6 7.8 34.7 22.9 42.5 42.5 11.6 29.4 8.9 99.1 8.9 131.4s2.7 102.1-8.9 131.4z"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className="share-svg-icon">
      <path
        fill="currentColor"
        d="M256 8a248 248 0 1 0 0 496 248 248 0 1 0 0-496zM371 176.7c-3.7 39.2-19.9 134.4-28.1 178.3-3.5 18.6-10.3 24.8-16.9 25.4-14.4 1.3-25.3-9.5-39.3-18.7-21.8-14.3-34.2-23.2-55.3-37.2-24.5-16.1-8.6-25 5.3-39.5 3.7-3.8 67.1-61.5 68.3-66.7 .2-.7 .3-3.1-1.2-4.4s-3.6-.8-5.1-.5c-2.2 .5-37.1 23.5-104.6 69.1-9.9 6.8-18.9 10.1-26.9 9.9-8.9-.2-25.9-5-38.6-9.1-15.5-5-27.9-7.7-26.8-16.3 .6-4.5 6.7-9 18.4-13.7 72.3-31.5 120.5-52.3 144.6-62.3 68.9-28.6 83.2-33.6 92.5-33.8 2.1 0 6.6 .5 9.6 2.9 2 1.7 3.2 4.1 3.5 6.7 .5 3.2 .6 6.5 .4 9.8z"
      />
    </svg>
  );
}

export function ShareActions(props: ShareActionsProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [instagramMenuOpen, setInstagramMenuOpen] = useState(false);

  async function getImageBlob(): Promise<Blob> {
    return props.buildImage();
  }

  async function tryNativeShareWithImage(channelLabel: string): Promise<boolean> {
    const navigatorAny = navigator as Navigator & {
      canShare?: (input: { files?: File[] }) => boolean;
    };
    if (!navigator.share) {
      return false;
    }

    const blob = await getImageBlob();
    const file = new File([blob], props.fileName, { type: "image/png" });
    if (!navigatorAny.canShare?.({ files: [file] })) {
      return false;
    }

    await navigator.share({
      title: props.shareText,
      text: props.shareText,
      files: [file],
    });
    setMessage(`Imagem compartilhada. Selecione ${channelLabel} no menu do dispositivo.`);
    return true;
  }

  function openWhatsApp(): void {
    setBusy(true);
    setMessage(null);
    void tryNativeShareWithImage("WhatsApp")
      .then(async (sharedNatively) => {
        if (sharedNatively) {
          return;
        }
        const blob = await getImageBlob();
        downloadBlob(blob, props.fileName);
        const pageUrl = window.location.href;
        const text = `${props.shareText}\n${pageUrl}\nImagem pronta para anexar no WhatsApp.`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        setMessage("Navegador não permitiu anexar imagem direto. Arquivo baixado para anexar no WhatsApp.");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Falha ao preparar compartilhamento.");
      })
      .finally(() => setBusy(false));
  }

  function openTelegram(): void {
    setBusy(true);
    setMessage(null);
    void tryNativeShareWithImage("Telegram")
      .then(async (sharedNatively) => {
        if (sharedNatively) {
          return;
        }
        const blob = await getImageBlob();
        downloadBlob(blob, props.fileName);
        const pageUrl = window.location.href;
        const text = `${props.shareText}\nImagem pronta para anexar no Telegram.`;
        window.open(
          `https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`,
          "_blank",
          "noopener,noreferrer",
        );
        setMessage("Navegador não permitiu anexar imagem direto. Arquivo baixado para anexar no Telegram.");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Falha ao preparar compartilhamento.");
      })
      .finally(() => setBusy(false));
  }

  function exportPng(): void {
    setBusy(true);
    setMessage(null);
    void getImageBlob()
      .then((blob) => {
        downloadBlob(blob, props.fileName);
        setMessage("Imagem exportada em PNG.");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Falha ao exportar PNG.");
      })
      .finally(() => setBusy(false));
  }

  async function shareInstagram(kind: "feed" | "story" | "reels"): Promise<void> {
    setBusy(true);
    setMessage(null);
    setInstagramMenuOpen(false);
    try {
      const blob = await getImageBlob();
      downloadBlob(blob, props.fileName);
      const label = kind === "feed" ? "Feed" : kind === "story" ? "Story" : "Reels";
      setMessage(`Imagem baixada. Abra o Instagram e publique no ${label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao preparar compartilhamento.");
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <div className={`share-actions-row ${props.iconOnly ? "icon-only" : ""}`}>
        <button
          type="button"
          className="share-app-button share-whatsapp"
          disabled={busy}
          onClick={openWhatsApp}
          aria-label="Compartilhar no WhatsApp"
          title="WhatsApp"
        >
          <span className="share-app-icon" aria-hidden><WhatsAppIcon /></span>
          {!props.iconOnly ? <span>Compartilhar no WhatsApp</span> : null}
        </button>

        <div className="share-instagram-wrap">
          <button
            type="button"
            className="share-app-button share-instagram"
            disabled={busy}
            onClick={() => setInstagramMenuOpen((prev) => !prev)}
            aria-label="Compartilhar no Instagram"
            title="Instagram"
          >
            <span className="share-app-icon" aria-hidden><InstagramIcon /></span>
            {!props.iconOnly ? <span>Compartilhar no Instagram</span> : null}
          </button>
          {instagramMenuOpen ? (
            <div className="share-instagram-menu" role="menu" aria-label="Destino Instagram">
              <button type="button" role="menuitem" disabled={busy} onClick={() => void shareInstagram("feed")}>Feed</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => void shareInstagram("story")}>Story</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => void shareInstagram("reels")}>Reels</button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="share-app-button share-telegram"
          disabled={busy}
          onClick={openTelegram}
          aria-label="Compartilhar no Telegram"
          title="Telegram"
        >
          <span className="share-app-icon" aria-hidden><TelegramIcon /></span>
          {!props.iconOnly ? <span>Compartilhar no Telegram</span> : null}
        </button>

        <button
          type="button"
          className="share-app-button"
          disabled={busy}
          onClick={exportPng}
          aria-label="Exportar para PNG"
          title="Exportar para PNG"
        >
          <span className="share-app-icon" aria-hidden>PNG</span>
          {!props.iconOnly ? <span>Exportar para PNG</span> : null}
        </button>
      </div>
      {message ? <p className="share-inline-message">{message}</p> : null}
    </>
  );

  if (props.inline) {
    return <div className="share-inline">{content}</div>;
  }

  return (
    <section className="card grid">
      <h3>Compartilhar</h3>
      {content}
    </section>
  );
}

