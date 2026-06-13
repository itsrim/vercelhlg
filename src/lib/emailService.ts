import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import {
  appPublicUrl,
  emailFrom,
  emailTransportLabel,
  isEmailConfigured,
  isMailjetConfigured,
  isSmtpConfigured,
  mailjetAuthHeader,
  parseEmailFrom,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser,
} from "./emailConfig.js";

let smtpTransporter: nodemailer.Transporter | null = null;

function getSmtpTransporter(): nodemailer.Transporter {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: smtpHost(),
      port: smtpPort(),
      secure: smtpSecure(),
      auth: {
        user: smtpUser(),
        pass: smtpPass(),
      },
    });
  }
  return smtpTransporter;
}

function buildVerificationHtml(displayName: string, verifyUrl: string): string {
  const name = displayName.trim() || "there";
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h1 style="font-size: 22px; margin-bottom: 8px;">Bienvenue sur Happy Let's GO, ${escapeHtml(name)} !</h1>
      <p style="line-height: 1.5; color: #444;">
        Merci de créer un compte. Cliquez sur le bouton ci-dessous pour confirmer votre adresse email.
        Ce lien expire dans 24&nbsp;heures.
      </p>
      <p style="margin: 28px 0;">
        <a href="${verifyUrl}" style="background: #fbbf24; color: #111; font-weight: 700; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block;">
          Vérifier mon email
        </a>
      </p>
      <p style="font-size: 13px; color: #888; word-break: break-all;">
        Ou copiez ce lien :<br />${verifyUrl}
      </p>
      <p style="font-size: 12px; color: #aaa; margin-top: 32px;">
        Si vous n'avez pas créé de compte Happy Let's GO, ignorez cet email.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 40px 0;" />

      <h1 style="font-size: 22px; margin-bottom: 8px;">Welcome to Happy Let's GO, ${escapeHtml(name)}!</h1>
      <p style="line-height: 1.5; color: #444;">
        Thank you for signing up. Click the button below to confirm your email address.
        This link expires in 24&nbsp;hours.
      </p>
      <p style="margin: 28px 0;">
        <a href="${verifyUrl}" style="background: #fbbf24; color: #111; font-weight: 700; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block;">
          Verify my email
        </a>
      </p>
      <p style="font-size: 13px; color: #888; word-break: break-all;">
        Or copy this link:<br />${verifyUrl}
      </p>
      <p style="font-size: 12px; color: #aaa; margin-top: 32px;">
        If you did not create a Happy Let's GO account, please ignore this email.
      </p>
    </div>
  `;
}

function buildPasswordResetHtml(displayName: string, resetUrl: string): string {
  const name = displayName.trim() || "there";
  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h1 style="font-size: 22px; margin-bottom: 8px;">Réinitialisation du mot de passe</h1>
      <p style="line-height: 1.5; color: #444;">
        Bonjour ${escapeHtml(name)}, cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
        Ce lien expire dans 1&nbsp;heure.
      </p>
      <p style="margin: 28px 0;">
        <a href="${resetUrl}" style="background: #fbbf24; color: #111; font-weight: 700; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block;">
          Choisir un nouveau mot de passe
        </a>
      </p>
      <p style="font-size: 13px; color: #888; word-break: break-all;">
        Ou copiez ce lien :<br />${resetUrl}
      </p>
      <p style="font-size: 12px; color: #aaa; margin-top: 32px;">
        Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
      </p>
    </div>
  `;
}

async function sendViaSmtp(message: Mail.Options): Promise<void> {
  const transporter = getSmtpTransporter();
  await transporter.sendMail(message);
}

async function sendViaMailjetHtml(
  to: string,
  displayName: string,
  subject: string,
  html: string,
): Promise<void> {
  const from = parseEmailFrom(emailFrom());
  const res = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: mailjetAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: from.email, Name: from.name },
          To: [{ Email: to, Name: displayName.trim() || to }],
          Subject: subject,
          HTMLPart: html,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[email] Mailjet API error:", res.status, body);
    throw new Error(`Envoi email échoué (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => null)) as {
    Messages?: Array<{ Status?: string; Errors?: Array<{ ErrorMessage?: string }> }>;
  } | null;
  const status = data?.Messages?.[0]?.Status;
  if (status && status !== "success") {
    const errMsg =
      data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage ?? `Statut Mailjet: ${status}`;
    console.error("[email] Mailjet send rejected:", errMsg);
    throw new Error(`Envoi email échoué: ${errMsg}`);
  }
}

async function sendHtmlEmail(
  to: string,
  displayName: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error("Service email non configuré");
  }

  const from = parseEmailFrom(emailFrom());

  if (isSmtpConfigured()) {
    try {
      await sendViaSmtp({
        from: { name: from.name, address: from.email },
        to: { name: displayName.trim() || to, address: to },
        subject,
        html,
      });
      return;
    } catch (err) {
      console.error("[email] SMTP send failed:", err);
      if (!isMailjetConfigured()) throw err;
      console.warn("[email] Fallback Mailjet après échec SMTP");
    }
  }

  if (isMailjetConfigured()) {
    await sendViaMailjetHtml(to, displayName, subject, html);
    return;
  }

  throw new Error("Service email non configuré");
}

export async function sendVerificationEmail(
  to: string,
  displayName: string,
  token: string,
): Promise<void> {
  const verifyUrl = buildVerificationUrl(token);

  if (!isEmailConfigured()) {
    console.warn("[email] Aucun transport configuré — email de vérification non envoyé");
    console.warn(`[email] Transport: ${emailTransportLabel()}`);
    console.warn(`[email] Lien de vérification (dev): ${verifyUrl}`);
    return;
  }

  await sendHtmlEmail(
    to,
    displayName,
    "Confirmation email — Happy let's GO !",
    buildVerificationHtml(displayName, verifyUrl),
  );
}

export async function sendPasswordResetEmail(
  to: string,
  displayName: string,
  token: string,
): Promise<void> {
  const resetUrl = buildPasswordResetUrl(token);

  if (!isEmailConfigured()) {
    console.warn("[email] Aucun transport configuré — email de réinitialisation non envoyé");
    console.warn(`[email] Lien de réinitialisation (dev): ${resetUrl}`);
    return;
  }

  await sendHtmlEmail(
    to,
    displayName,
    "Réinitialisation du mot de passe — Happy let's GO",
    buildPasswordResetHtml(displayName, resetUrl),
  );
}

export function buildVerificationUrl(token: string): string {
  return buildAppUrlParam("verifyEmail", token);
}

export function buildPasswordResetUrl(token: string): string {
  return buildAppUrlParam("resetPassword", token);
}

function buildAppUrlParam(param: string, token: string): string {
  const base = appPublicUrl();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${param}=${encodeURIComponent(token)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
