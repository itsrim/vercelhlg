import { createHash } from "node:crypto";

/** Vérifie le mot de passe contre passwordHash du Sheet (sha256:… ou legacy clair). */
export function verifyPasswordForSheet(password: string, stored: string): boolean {
  const trimmed = stored.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith("sha256:")) {
    const actual = createHash("sha256").update(password).digest("hex");
    return trimmed === `sha256:${actual}`;
  }

  return trimmed === password;
}
