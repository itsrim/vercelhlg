export function resendApiKey(): string {
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || "Nel <onboarding@resend.dev>";
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
  return resendApiKey().length > 0;
}
