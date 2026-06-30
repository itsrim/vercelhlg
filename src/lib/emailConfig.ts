export function mailjetApiKey(): string {
  return process.env.MAILJET_API_KEY?.trim() ?? "";
}

export function mailjetApiSecret(): string {
  return process.env.MAILJET_API_SECRET?.trim() ?? "";
}

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

export function isEmailConfigured(): boolean {
  return mailjetApiKey().length > 0 && mailjetApiSecret().length > 0;
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
