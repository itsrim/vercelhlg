import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AuthUser } from "./types.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "hlg-dev-secret-change-in-production",
);

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

interface StoredUser extends AuthUser {
  password: string;
  emailVerified: boolean;
  verificationToken?: string;
  verificationExpiresAt?: number;
  passwordResetToken?: string;
  passwordResetExpiresAt?: number;
}

const usersByEmail = new Map<string, StoredUser>();
const usersById = new Map<string, StoredUser>();
const usersByVerificationToken = new Map<string, StoredUser>();
const usersByPasswordResetToken = new Map<string, StoredUser>();

function registerUser(user: StoredUser): void {
  usersByEmail.set(user.email, user);
  usersById.set(user.id, user);
  if (user.verificationToken) {
    usersByVerificationToken.set(user.verificationToken, user);
  }
}

function clearVerificationToken(user: StoredUser): void {
  if (user.verificationToken) {
    usersByVerificationToken.delete(user.verificationToken);
    user.verificationToken = undefined;
    user.verificationExpiresAt = undefined;
  }
}

function clearPasswordResetToken(user: StoredUser): void {
  if (user.passwordResetToken) {
    usersByPasswordResetToken.delete(user.passwordResetToken);
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
  }
}

function createSecureToken(): string {
  return randomBytes(32).toString("hex");
}

function toAuthUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  };
}

function createVerificationToken(): string {
  return createSecureToken();
}

function seedDemoUser(user: StoredUser): void {
  user.emailVerified = true;
  clearVerificationToken(user);
  registerUser(user);
}

seedDemoUser({
  id: "user_demo_001",
  email: "demo@hlg.com",
  displayName: "Utilisateur Demo",
  password: "password",
  emailVerified: true,
});

seedDemoUser({
  id: "user_admin_001",
  email: "rim",
  displayName: "Admin",
  password: "1234",
  emailVerified: true,
});

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
    const stored = usersById.get(id);
    return {
      id,
      email,
      displayName,
      emailVerified: stored?.emailVerified ?? payload.emailVerified === true,
    };
  } catch {
    return null;
  }
}

export function loginUser(email: string, password: string): AuthUser {
  const user = usersByEmail.get(email.trim().toLowerCase());
  if (!user || user.password !== password) {
    throw new Error("Email ou mot de passe incorrect");
  }
  if (!user.emailVerified) {
    throw new Error(
      "Veuillez confirmer votre email avant de vous connecter. Consultez votre boîte mail ou renvoyez l'email de vérification.",
    );
  }
  return toAuthUser(user);
}

export interface SignupResult {
  user: AuthUser;
  verificationToken: string;
}

export function signupUser(
  email: string,
  password: string,
  displayName: string,
  options?: { skipEmailVerification?: boolean },
): SignupResult {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || !displayName.trim()) {
    throw new Error("Tous les champs sont requis");
  }
  if (password.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  }
  if (usersByEmail.has(normalizedEmail)) {
    throw new Error("Cet email est déjà utilisé");
  }

  const skipVerify = options?.skipEmailVerification === true;
  const verificationToken = skipVerify ? undefined : createVerificationToken();
  const user: StoredUser = {
    id: `user_${Date.now()}_${randomBytes(4).toString("hex")}`,
    email: normalizedEmail,
    displayName: displayName.trim(),
    password,
    emailVerified: skipVerify,
    verificationToken,
    verificationExpiresAt: skipVerify
      ? undefined
      : Date.now() + VERIFICATION_TTL_MS,
  };

  registerUser(user);
  return {
    user: toAuthUser(user),
    verificationToken: verificationToken ?? "",
  };
}

export function verifyEmailByToken(token: string): AuthUser {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Lien de vérification invalide");
  }

  const user = usersByVerificationToken.get(trimmed);
  if (!user) {
    throw new Error("Lien de vérification invalide ou déjà utilisé");
  }
  if (user.verificationExpiresAt != null && Date.now() > user.verificationExpiresAt) {
    throw new Error("Ce lien a expiré. Demandez un nouvel email de vérification.");
  }

  user.emailVerified = true;
  clearVerificationToken(user);
  return toAuthUser(user);
}

export function resendVerificationForEmail(email: string): SignupResult | null {
  const user = usersByEmail.get(email.trim().toLowerCase());
  if (!user || user.emailVerified) {
    return null;
  }

  clearVerificationToken(user);
  user.verificationToken = createVerificationToken();
  user.verificationExpiresAt = Date.now() + VERIFICATION_TTL_MS;
  usersByVerificationToken.set(user.verificationToken, user);

  return { user: toAuthUser(user), verificationToken: user.verificationToken };
}

export interface PasswordResetRequest {
  email: string;
  displayName: string;
  passwordResetToken: string;
}

export function requestPasswordResetForEmail(
  email: string,
): PasswordResetRequest | null {
  const user = usersByEmail.get(email.trim().toLowerCase());
  if (!user) return null;

  clearPasswordResetToken(user);
  user.passwordResetToken = createSecureToken();
  user.passwordResetExpiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  usersByPasswordResetToken.set(user.passwordResetToken, user);

  return {
    email: user.email,
    displayName: user.displayName,
    passwordResetToken: user.passwordResetToken,
  };
}

export function resetPasswordByToken(token: string, newPassword: string): AuthUser {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Lien de réinitialisation invalide");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Le mot de passe doit contenir au moins 6 caractères");
  }

  const user = usersByPasswordResetToken.get(trimmed);
  if (!user) {
    throw new Error("Lien de réinitialisation invalide ou déjà utilisé");
  }
  if (
    user.passwordResetExpiresAt != null &&
    Date.now() > user.passwordResetExpiresAt
  ) {
    clearPasswordResetToken(user);
    throw new Error("Ce lien a expiré. Demandez un nouvel email de réinitialisation.");
  }

  user.password = newPassword;
  clearPasswordResetToken(user);
  return toAuthUser(user);
}

export function getUserById(userId: string): AuthUser | null {
  const user = usersById.get(userId);
  if (!user) return null;
  return toAuthUser(user);
}
