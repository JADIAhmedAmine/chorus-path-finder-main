/**
 * Feature flags du frontend (version limitée).
 *
 * `FLUX_ENABLED` pilote l'affichage du socle « Flux » : le hub `/flux`, le dépôt de
 * flux, la préparation « PDF facture → flux » et le dépôt G2B — aussi bien dans la
 * navigation que dans les routes. Masqué par défaut dans cette version limitée
 * centrée sur les factures ; le backend reste inchangé.
 *
 * Pour réactiver le socle flux :
 *   - soit passer `FLUX_ENABLED_FALLBACK` à `true` ci-dessous,
 *   - soit définir `VITE_FLUX_ENABLED=true` au build (sans toucher au code).
 */
const FLUX_ENABLED_FALLBACK = false;

function parseBoolFlag(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export const FLUX_ENABLED = parseBoolFlag(
  import.meta.env.VITE_FLUX_ENABLED,
  FLUX_ENABLED_FALLBACK,
);
