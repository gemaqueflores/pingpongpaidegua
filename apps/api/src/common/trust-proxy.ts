export function applyTrustProxy(
  app: { set: (key: string, value: unknown) => void },
  rawValue: unknown = process.env.TRUST_PROXY,
): void {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    return;
  }

  if (/^\d+$/.test(raw)) {
    app.set("trust proxy", Number(raw));
    return;
  }

  if (raw.toLowerCase() === "true") {
    app.set("trust proxy", true);
    return;
  }

  if (raw.toLowerCase() === "false") {
    app.set("trust proxy", false);
    return;
  }

  const trustedHops = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  app.set("trust proxy", trustedHops.length > 0 ? trustedHops : raw);
}
