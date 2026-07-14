import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AuthUser } from "./types.js";
import {
  isSheetsReadConfigured,
  isSheetsWriteConfigured,
  sheetGet,
  sheetPut,
} from "./googleSheets.js";
import { parseBool } from "./sheetCsv.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "hlg-dev-secret-change-in-production",
);

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Auth : Google Sheets = source de vérité (viewer_settings). */

function createSecureToken(): string {
  return randomBytes(32).toString("hex");
}

type ViewerSettingsRow = Record<string, string>;

export function authStorageMode(): "sheets" | "unconfigured" {
  return isSheetsReadConfigured() ? "sheets" : "unconfigured";
}

export async function createToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const id = payload.sub;
    const email = payload.email;
    const displayName = payload.displayName;
    if (typeof id !== "string" || typeof email !== "string" || typeof displayName !== "string") {
      return null;
    }
    return {
      id,
      email,
      displayName,
      emailVerified: payload.emailVerified === true,
    };
  } catch {
    return null;
  }
}

/** JWT chat après login validé côté front (Sheets). */
export async function createSessionFromUser(user: AuthUser): Promise<{
  user: AuthUser;
  token: string;
}> {
  const authUser: AuthUser = {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    displayName: user.displayName.trim(),
    emailVerified: user.emailVerified !== false,
  };
  const token = await createToken(authUser);
  return { user: authUser, token };
}

export interface SignupSheetAuth {
  emailVerified: boolean;
  verificationToken: string;
  verificationExpiresAt: number | null;
}

export interface SignupResult {
  user: AuthUser;
  verificationToken: string;
  sheetAuth: SignupSheetAuth;
}

export function signupUser(
  email: string,
  password: string,
  displayName: string,
  options?: {
    skipEmailVerification?: boolean;
    userId?: string;
    verificationToken?: string;
    verificationExpiresAt?: number | null;
  },
): SignupResult {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || !displayName.trim()) {
    throw new Error("Tous les champs sont requis");
  }
  if (password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  }

  const skipVerify = options?.skipEmailVerification === true;
  const fromClient = options?.verificationToken?.trim();
  const verificationToken = fromClient || createSecureToken();
  const verificationExpiresAt =
    options?.verificationExpiresAt != null && options.verificationExpiresAt > 0
      ? options.verificationExpiresAt
      : Date.now() + VERIFICATION_TTL_MS;

  const user: AuthUser = {
    id: options?.userId?.trim() || `user_${Date.now()}_${randomBytes(4).toString("hex")}`,
    email: normalizedEmail,
    displayName: displayName.trim(),
    emailVerified: skipVerify,
  };

  return {
    user,
    verificationToken,
    sheetAuth: {
      emailVerified: user.emailVerified ?? false,
      verificationToken,
      verificationExpiresAt,
    },
  };
}

export function resendVerificationForEmail(
  email: string,
  displayName: string,
  options?: { verificationToken?: string; verificationExpiresAt?: number | null },
): { verificationToken: string; sheetAuth: SignupSheetAuth } {
  const verificationToken = options?.verificationToken?.trim() || createSecureToken();
  const verificationExpiresAt =
    options?.verificationExpiresAt !== undefined
      ? options.verificationExpiresAt
      : Date.now() + VERIFICATION_TTL_MS;
  return {
    verificationToken,
    sheetAuth: {
      emailVerified: false,
      verificationToken,
      verificationExpiresAt,
    },
  };
}

export interface PasswordResetRequest {
  email: string;
  displayName: string;
  passwordResetToken: string;
  passwordResetExpiresAt: number;
}

export function requestPasswordResetForEmail(
  email: string,
  displayName: string,
  options?: {
    passwordResetToken?: string;
    passwordResetExpiresAt?: number | null;
  },
): PasswordResetRequest {
  const token = options?.passwordResetToken?.trim() || createSecureToken();
  return {
    email: email.trim().toLowerCase(),
    displayName: displayName.trim() || email,
    passwordResetToken: token,
    passwordResetExpiresAt:
      options?.passwordResetExpiresAt != null && options.passwordResetExpiresAt > 0
        ? options.passwordResetExpiresAt
        : Date.now() + PASSWORD_RESET_TTL_MS,
  };
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  if (!isSheetsReadConfigured()) return null;
  const rows = await sheetGet<ViewerSettingsRow>("viewer_settings");
  const row = rows.find(
    (r) =>
      (r.id?.trim() === userId || r.userId?.trim() === userId) &&
      r.deleted !== "true",
  );
  if (!row) return null;
  const id = row.id?.trim() || row.userId?.trim() || userId;
  const email = row.email?.trim().toLowerCase();
  if (!email) return null;
  return {
    id,
    email,
    displayName: row.displayName?.trim() || email,
    emailVerified: parseBool(row.emailVerified),
  };
}

async function findViewerByVerificationToken(
  token: string,
): Promise<ViewerSettingsRow | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const rows = await sheetGet<ViewerSettingsRow>("viewer_settings");
  return (
    rows.find(
      (r) => r.verificationToken?.trim() === trimmed && r.deleted !== "true",
    ) ?? null
  );
}

/** Vérifie le token dans viewer_settings (Google Sheets) et marque emailVerified. */
export async function verifyEmailByToken(token: string): Promise<AuthUser> {
  if (!isSheetsReadConfigured()) {
    throw new Error("Google Sheets non configuré");
  }

  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Lien de vérification invalide");
  }

  const row = await findViewerByVerificationToken(trimmed);
  if (!row) {
    throw new Error("Lien de vérification invalide ou déjà utilisé");
  }

  const id = row.id?.trim() || row.userId?.trim();
  const email = row.email?.trim().toLowerCase();
  if (!id || !email) {
    throw new Error("Lien de vérification invalide");
  }

  if (parseBool(row.emailVerified)) {
    return {
      id,
      email,
      displayName: row.displayName?.trim() || email,
      emailVerified: true,
    };
  }

  const expiresRaw = row.verificationExpiresAt?.trim();
  const expires = expiresRaw ? Number(expiresRaw) : null;
  if (expires != null && Number.isFinite(expires) && Date.now() > expires) {
    throw new Error("Ce lien a expiré. Demandez un nouvel email de vérification.");
  }

  if (isSheetsWriteConfigured()) {
    await sheetPut("viewer_settings", id, {
      emailVerified: "true",
      verificationToken: "",
      verificationExpiresAt: "",
    });
  }

  return {
    id,
    email,
    displayName: row.displayName?.trim() || email,
    emailVerified: true,
  };
}
