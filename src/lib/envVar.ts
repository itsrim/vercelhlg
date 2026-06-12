/** Lit une variable d'env — accepte le préfixe VITE_ (même noms que le frontend). */
export function envVar(...keys: string[]): string {
  for (const key of keys) {
    const direct = process.env[key]?.trim();
    if (direct) return direct;
    if (!key.startsWith("VITE_")) {
      const vite = process.env[`VITE_${key}`]?.trim();
      if (vite) return vite;
    }
  }
  return "";
}
