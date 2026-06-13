export function emailFrom(): string {
  return (
    process.env.EMAIL_FROM?.trim() || "Happy Let's GO <noreply@happyletsgo.fr>"
  );
}

/** URL du frontend (sans slash final) — lien « Vérifier mon email ». */
export function appPublicUrl(): string {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}

export function smtpHost(): string {
  return process.env.SMTP_HOST?.trim() ?? "";
}

export function smtpPort(): number {
  const raw = process.env.SMTP_PORT?.trim();
  const n = raw ? parseInt(raw, 10) : 587;
  return Number.isFinite(n) ? n : 587;
}

export function smtpSecure(): boolean {
  const raw = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return smtpPort() === 465;
}

export function smtpUser(): string {
  return process.env.SMTP_USER?.trim() ?? "";
}

export function smtpPass(): string {
  return process.env.SMTP_PASS?.trim() ?? "";
}

/** Clé API Brevo v3 (`xkeysib-…`) — HTTPS, fonctionne sur Render free tier. */
export function brevoApiKey(): string {
  return (
    process.env.BREVO_API_KEY?.trim() ??
    process.env.APIKEY_BREVO?.trim() ??
    ""
  );
}

/** Mailjet (legacy) — conservé si déjà configuré. */
export function mailjetApiKey(): string {
  return process.env.MAILJET_API_KEY?.trim() ?? "";
}

export function mailjetApiSecret(): string {
  return process.env.MAILJET_API_SECRET?.trim() ?? "";
}

export function isBrevoApiConfigured(): boolean {
  return brevoApiKey().length > 0;
}

export function isSmtpConfigured(): boolean {
  return smtpHost().length > 0 && smtpUser().length > 0 && smtpPass().length > 0;
}

export function isMailjetConfigured(): boolean {
  return mailjetApiKey().length > 0 && mailjetApiSecret().length > 0;
}

export function isEmailConfigured(): boolean {
  return isBrevoApiConfigured() || isSmtpConfigured() || isMailjetConfigured();
}

export function emailTransportLabel(): string {
  if (isBrevoApiConfigured()) return "Brevo API (HTTPS)";
  if (isSmtpConfigured()) return `SMTP (${smtpHost()})`;
  if (isMailjetConfigured()) return "Mailjet API";
  return "not-configured";
}

export function mailjetAuthHeader(): string {
  const token = Buffer.from(`${mailjetApiKey()}:${mailjetApiSecret()}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

export function parseEmailFrom(raw: string): { email: string; name: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ""),
      email: match[2].trim(),
    };
  }
  return { name: "Happy Let's GO", email: trimmed };
}
