import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const trimmed = stored.trim();
  if (!trimmed) return false;
  const [salt, hashHex] = trimmed.split(":");
  if (!salt || !hashHex) return false;
  try {
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hashHex, "hex");
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Compatibilité comptes seed en clair (dev uniquement). */
export function isLegacyPlainPassword(stored: string): boolean {
  return stored.length > 0 && !stored.includes(":");
}

export async function verifyPasswordOrLegacy(
  password: string,
  stored: string,
): Promise<boolean> {
  if (isLegacyPlainPassword(stored)) {
    return stored === password;
  }
  return verifyPassword(password, stored);
}
