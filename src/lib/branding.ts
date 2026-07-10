/**
 * Marque blanche : nom, slogan, logo et couleur principale de l'application.
 *
 * Le branding est servi par le backend (`GET /api/branding`, public) et
 * appliqué avant le premier rendu React (voir `main.tsx`). Une copie est mise
 * en cache dans le localStorage pour un affichage instantané au démarrage.
 */

export interface AppBranding {
  appName: string;
  appTagline: string;
  /** Couleur principale au format #rrggbb, chaîne vide = thème par défaut. */
  primaryColor: string;
  /** URL du logo personnalisé servi par le backend, null = logo par défaut. */
  logoUrl: string | null;
}

export const DEFAULT_LOGO_PATH = '/app-symbol.svg';

export const DEFAULT_BRANDING: AppBranding = {
  appName: 'Chorus Pilot',
  appTagline: 'Automatisation des factures Chorus Pro',
  primaryColor: '',
  logoUrl: null,
};

/** Équivalent hex de la couleur --primary par défaut (hsl(224 76% 48%)). */
export const DEFAULT_PRIMARY_HEX = '#1d4fd7';

const BRANDING_STORAGE_KEY = 'app.branding';
const BRANDING_STYLE_ELEMENT_ID = 'app-branding-overrides';

let currentBranding: AppBranding = { ...DEFAULT_BRANDING };

export function getBranding(): AppBranding {
  return currentBranding;
}

export function getAppName(): string {
  return currentBranding.appName;
}

export function getAppTagline(): string {
  return currentBranding.appTagline;
}

export function getAppLogoUrl(): string {
  return currentBranding.logoUrl || DEFAULT_LOGO_PATH;
}

export function sanitizeBranding(raw: unknown): AppBranding {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const appName = typeof source.appName === 'string' && source.appName.trim() ? source.appName.trim() : DEFAULT_BRANDING.appName;
  const appTagline = typeof source.appTagline === 'string' ? source.appTagline.trim() : DEFAULT_BRANDING.appTagline;
  const primaryColor =
    typeof source.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.primaryColor.trim())
      ? source.primaryColor.trim().toLowerCase()
      : '';
  const logoUrl =
    typeof source.logoUrl === 'string' && source.logoUrl.startsWith('/api/branding/logo') ? source.logoUrl : null;
  return { appName, appTagline, primaryColor, logoUrl };
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): HslColor | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return null;
  }

  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta > 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  if (h < 0) {
    h += 360;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex({ h, s, l }: HslColor): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return `#${rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const cssHsl = ({ h, s, l }: HslColor) => `${h} ${s}% ${l}%`;

function applyPrimaryColor(hex: string): void {
  const existing = document.getElementById(BRANDING_STYLE_ELEMENT_ID);
  const hsl = hex ? hexToHsl(hex) : null;
  if (!hsl) {
    existing?.remove();
    return;
  }

  const { h, s, l } = hsl;
  const light = {
    primary: { h, s, l: clamp(l, 24, 62) },
    hover: { h, s, l: clamp(l - 6, 16, 56) },
    soft: { h, s: clamp(s + 20, 20, 100), l: 96 },
    sidebarRing: { h, s, l: clamp(l + 10, 30, 72) },
  };
  const dark = {
    primary: { h, s, l: clamp(l + 12, 45, 72) },
    hover: { h, s, l: clamp(l + 18, 50, 78) },
    soft: { h, s: clamp(Math.round(s * 0.6), 15, 70), l: 18 },
  };

  const css = [
    ':root {',
    `  --primary: ${cssHsl(light.primary)};`,
    `  --primary-hover: ${cssHsl(light.hover)};`,
    `  --primary-soft: ${cssHsl(light.soft)};`,
    `  --accent: ${cssHsl(light.primary)};`,
    `  --ring: ${cssHsl(light.primary)};`,
    `  --sidebar-ring: ${cssHsl(light.sidebarRing)};`,
    `  --chart-1: ${cssHsl(light.primary)};`,
    '}',
    '.dark {',
    `  --primary: ${cssHsl(dark.primary)};`,
    `  --primary-hover: ${cssHsl(dark.hover)};`,
    `  --primary-soft: ${cssHsl(dark.soft)};`,
    `  --accent: ${cssHsl(dark.primary)};`,
    `  --ring: ${cssHsl(dark.primary)};`,
    `  --sidebar-ring: ${cssHsl(dark.primary)};`,
    `  --chart-1: ${cssHsl(dark.primary)};`,
    '}',
  ].join('\n');

  if (existing) {
    existing.textContent = css;
    return;
  }
  const style = document.createElement('style');
  style.id = BRANDING_STYLE_ELEMENT_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

export function applyBranding(branding: AppBranding): void {
  currentBranding = branding;
  document.title = branding.appName;
  const iconHref = getAppLogoUrl();
  document
    .querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => link.setAttribute('href', iconHref));
  applyPrimaryColor(branding.primaryColor);
}

/** Applique le branding et le met en cache pour les prochains démarrages. */
export function commitBranding(raw: unknown): AppBranding {
  const branding = sanitizeBranding(raw);
  applyBranding(branding);
  try {
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding));
  } catch {
    // stockage local indisponible : le branding restera chargé depuis l'API
  }
  return branding;
}

/**
 * Charge le branding avant le premier rendu : cache local immédiat, puis
 * rafraîchissement depuis le backend (timeout court pour ne pas bloquer).
 */
export async function initBranding(): Promise<void> {
  try {
    const cached = localStorage.getItem(BRANDING_STORAGE_KEY);
    if (cached) {
      applyBranding(sanitizeBranding(JSON.parse(cached)));
    }
  } catch {
    // cache illisible : on garde les valeurs par défaut
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const response = await fetch('/api/branding', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!response.ok) {
      return;
    }
    commitBranding(await response.json());
  } catch {
    // backend injoignable : valeurs par défaut ou cache local
  }
}
