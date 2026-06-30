import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  isSheetsReadConfigured,
  isSheetsWriteConfigured,
  sheetGet,
  sheetPost,
  sheetPut,
} from "./googleSheets.js";
import { hashPassword, verifyPasswordOrLegacy } from "./passwordHash.js";
import { parseBool } from "./sheetCsv.js";
import type { AuthUser } from "./types.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "hlg-dev-secret-change-in-production",
);

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type ViewerSettingsRow = Record<string, string>;

export interface StoredUser extends AuthUser {
  passwordHash: string;
  emailVerified: boolean;
  verificationToken?: string;
  verificationExpiresAt?: number;
  passwordResetToken?: string;
  passwordResetExpiresAt?: number;
}

/** Fallback mémoire si Sheets non configuré (dev local). */
const memoryUsersByEmail = new Map<string, StoredUser>();
const memoryUsersByVerificationToken = new Map<string, StoredUser>();
const memoryUsersByPasswordResetToken = new Map<string, StoredUser>();

function createSecureToken(): string {
  return randomBytes(32).toString("hex");
}

function rowToStoredUser(row: ViewerSettingsRow): StoredUser | null {
  const id = row.id?.trim() || row.userId?.trim();
  const email = row.email?.trim().toLowerCase();
  if (!id || !email || row.deleted === "true") return null;

  return {
    id,
    email,
    displayName: row.displayName?.trim() || email,
    emailVerified: parseBool(row.emailVerified),
    passwordHash: row.passwordHash?.trim() ?? "",
    verificationToken: row.verificationToken?.trim() || undefined,
    verificationExpiresAt: row.verificationExpiresAt
      ? Number(row.verificationExpiresAt)
      : undefined,
    passwordResetToken: row.passwordResetToken?.trim() || undefined,
    passwordResetExpiresAt: row.passwordResetExpiresAt
      ? Number(row.passwordResetExpiresAt)
      : undefined,
  };
}

function storedUserToRow(user: StoredUser): Record<string, string> {
  return {
    userId: user.id,
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified ? "true" : "false",
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    verificationToken: user.verificationToken ?? "",
    verificationExpiresAt:
      user.verificationExpiresAt != null ? String(user.verificationExpiresAt) : "",
    passwordResetToken: user.passwordResetToken ?? "",
    passwordResetExpiresAt:
      user.passwordResetExpiresAt != null ? String(user.passwordResetExpiresAt) : "",
    avatarUrl: "",
    isPro: "false",
    deleted: "false",
  };
}

function authPatch(user: StoredUser): Record<string, string> {
  return {
    emailVerified: user.emailVerified ? "true" : "false",
    passwordHash: user.passwordHash,
    verificationToken: user.verificationToken ?? "",
    verificationExpiresAt:
      user.verificationExpiresAt != null ? String(user.verificationExpiresAt) : "",
    passwordResetToken: user.passwordResetToken ?? "",
    passwordResetExpiresAt:
      user.passwordResetExpiresAt != null ? String(user.passwordResetExpiresAt) : "",
  };
}

async function loadAllUsersFromSheets(): Promise<StoredUser[]> {
  const rows = await sheetGet<ViewerSettingsRow>("viewer_settings");
  return rows.map(rowToStoredUser).filter((u): u is StoredUser => u != null);
}

async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  if (isSheetsReadConfigured()) {
    const users = await loadAllUsersFromSheets();
    return users.find((u) => u.email === normalized) ?? null;
  }

  return memoryUsersByEmail.get(normalized) ?? null;
}

async function findUserByVerificationToken(
  token: string,
): Promise<StoredUser | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (isSheetsReadConfigured()) {
    const users = await loadAllUsersFromSheets();
    return users.find((u) => u.verificationToken === trimmed) ?? null;
  }

  return memoryUsersByVerificationToken.get(trimmed) ?? null;
}

async function findUserByPasswordResetToken(
  token: string,
): Promise<StoredUser | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (isSheetsReadConfigured()) {
    const users = await loadAllUsersFromSheets();
    return users.find((u) => u.passwordResetToken === trimmed) ?? null;
  }

  return memoryUsersByPasswordResetToken.get(trimmed) ?? null;
}

async function persistUser(user: StoredUser): Promise<void> {
  if (isSheetsWriteConfigured()) {
    await sheetPut("viewer_settings", user.id, authPatch(user));
    return;
  }
  registerMemoryUser(user);
}

async function createUser(user: StoredUser): Promise<void> {
  if (isSheetsWriteConfigured()) {
    const row = storedUserToRow(user);
    const result = await sheetPost("viewer_settings", row);
    if (result.skipped) {
      await sheetPut("viewer_settings", user.id, row);
    }
    return;
  }
  registerMemoryUser(user);
}

function registerMemoryUser(user: StoredUser): void {
  memoryUsersByEmail.set(user.email, user);
  if (user.verificationToken) {
    memoryUsersByVerificationToken.set(user.verificationToken, user);
  }
  if (user.passwordResetToken) {
    memoryUsersByPasswordResetToken.set(user.passwordResetToken, user);
  }
}

function clearVerificationToken(user: StoredUser): void {
  if (user.verificationToken && !isSheetsReadConfigured()) {
    memoryUsersByVerificationToken.delete(user.verificationToken);
  }
  user.verificationToken = undefined;
  user.verificationExpiresAt = undefined;
}

function clearPasswordResetToken(user: StoredUser): void {
  if (user.passwordResetToken && !isSheetsReadConfigured()) {
    memoryUsersByPasswordResetToken.delete(user.passwordResetToken);
  }
  user.passwordResetToken = undefined;
  user.passwordResetExpiresAt = undefined;
}

function seedMemoryDemoUsers(): void {
  if (memoryUsersByEmail.size > 0) return;
  for (const u of [
    {
      id: "user_demo_001",
      email: "demo@hlg.com",
      displayName: "Utilisateur Demo",
      passwordHash: "password",
      emailVerified: true,
    },
    {
      id: "user_admin_001",
      email: "rim",
      displayName: "Admin",
      passwordHash: "1234",
      emailVerified: true,
    },
  ] as StoredUser[]) {
    registerMemoryUser(u);
  }
}

export function toAuthUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
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

    if (isSheetsReadConfigured()) {
      const users = await loadAllUsersFromSheets();
      const stored = users.find((u) => u.id === id);
      if (stored) return toAuthUser(stored);
    } else {
      seedMemoryDemoUsers();
      const stored = [...memoryUsersByEmail.values()].find((u) => u.id === id);
      if (stored) return toAuthUser(stored);
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

export async function validateLoginCredentials(
  email: string,
  password: string,
): Promise<StoredUser> {
  if (!isSheetsReadConfigured()) seedMemoryDemoUsers();

  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash) {
    throw new Error("Email ou mot de passe incorrect");
  }

  const ok = await verifyPasswordOrLegacy(password, user.passwordHash);
  if (!ok) {
    throw new Error("Email ou mot de passe incorrect");
  }
  return user;
}

export async function markUserEmailVerified(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user) return;
  user.emailVerified = true;
  clearVerificationToken(user);
  await persistUser(user);
}

export interface SignupResult {
  user: AuthUser;
  verificationToken: string;
}

export async function signupUser(
  email: string,
  password: string,
  displayName: string,
  options?: { skipEmailVerification?: boolean },
): Promise<SignupResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || !displayName.trim()) {
    throw new Error("Tous les champs sont requis");
  }
  if (password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("Cet email est déjà utilisé");
  }

  const skipVerify = options?.skipEmailVerification === true;
  const verificationToken = skipVerify ? undefined : createSecureToken();
  const passwordHash = await hashPassword(password);

  const user: StoredUser = {
    id: `user_${Date.now()}_${randomBytes(4).toString("hex")}`,
    email: normalizedEmail,
    displayName: displayName.trim(),
    passwordHash,
    emailVerified: skipVerify,
    verificationToken,
    verificationExpiresAt: skipVerify ? undefined : Date.now() + VERIFICATION_TTL_MS,
  };

  await createUser(user);
  if (verificationToken) {
    registerMemoryUser(user);
  }

  return {
    user: toAuthUser(user),
    verificationToken: verificationToken ?? "",
  };
}

export async function verifyEmailByToken(token: string): Promise<AuthUser> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Lien de vérification invalide");
  }

  const user = await findUserByVerificationToken(trimmed);
  if (!user) {
    throw new Error("Lien de vérification invalide ou déjà utilisé");
  }
  if (user.verificationExpiresAt != null && Date.now() > user.verificationExpiresAt) {
    throw new Error("Ce lien a expiré. Demandez un nouvel email de vérification.");
  }

  user.emailVerified = true;
  clearVerificationToken(user);
  await persistUser(user);
  return toAuthUser(user);
}

export async function resendVerificationForEmail(
  email: string,
): Promise<SignupResult | null> {
  const user = await findUserByEmail(email);
  if (!user || user.emailVerified) {
    return null;
  }

  clearVerificationToken(user);
  user.verificationToken = createSecureToken();
  user.verificationExpiresAt = Date.now() + VERIFICATION_TTL_MS;
  await persistUser(user);
  if (user.verificationToken) {
    memoryUsersByVerificationToken.set(user.verificationToken, user);
  }

  return { user: toAuthUser(user), verificationToken: user.verificationToken! };
}

export interface PasswordResetRequest {
  email: string;
  displayName: string;
  passwordResetToken: string;
}

export async function requestPasswordResetForEmail(
  email: string,
): Promise<PasswordResetRequest | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;

  clearPasswordResetToken(user);
  user.passwordResetToken = createSecureToken();
  user.passwordResetExpiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  await persistUser(user);
  if (user.passwordResetToken) {
    memoryUsersByPasswordResetToken.set(user.passwordResetToken, user);
  }

  return {
    email: user.email,
    displayName: user.displayName,
    passwordResetToken: user.passwordResetToken!,
  };
}

export async function resetPasswordByToken(
  token: string,
  newPassword: string,
): Promise<AuthUser> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Lien de réinitialisation invalide");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  }

  const user = await findUserByPasswordResetToken(trimmed);
  if (!user) {
    throw new Error("Lien de réinitialisation invalide ou déjà utilisé");
  }
  if (
    user.passwordResetExpiresAt != null &&
    Date.now() > user.passwordResetExpiresAt
  ) {
    clearPasswordResetToken(user);
    await persistUser(user);
    throw new Error("Ce lien a expiré. Demandez un nouvel email de réinitialisation.");
  }

  user.passwordHash = await hashPassword(newPassword);
  clearPasswordResetToken(user);
  await persistUser(user);
  return toAuthUser(user);
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  if (isSheetsReadConfigured()) {
    const users = await loadAllUsersFromSheets();
    const user = users.find((u) => u.id === userId);
    return user ? toAuthUser(user) : null;
  }
  seedMemoryDemoUsers();
  const user = [...memoryUsersByEmail.values()].find((u) => u.id === userId);
  return user ? toAuthUser(user) : null;
}

export function authStorageMode(): "sheets" | "memory" {
  return isSheetsReadConfigured() ? "sheets" : "memory";
}
