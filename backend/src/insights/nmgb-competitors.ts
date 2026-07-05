// ── Chinese / Chinese-owned OEM classification (NMGB Survey, Prompt 2) ───────
// Normalise a free-text vehicle make to an uppercase alphanumeric key so that
// variants ("MG Motor", "byd", "Lynk & Co") collapse to one token, then test
// membership. Volvo / Polestar / Lotus / Smart are included as Chinese-OWNED
// (Geely) per the brief's "Chinese or Chinese-Owned OEMs" grouping.
//
// Standalone (no DB dependency) so both the survey dashboard and the narrative
// generator can share it without coupling to any one data source.

const CHINESE_OEM_KEYS = new Set([
  'MG', 'MGMOTOR', 'MGMOTORS',
  'BYD',
  'OMODA', 'JAECOO',
  'GWM', 'GREATWALL', 'GREATWALLMOTOR', 'GREATWALLMOTORS',
  'ORA',
  'XPENG',
  'LEAPMOTOR',
  'SMART',
  'VOLVO', 'POLESTAR', 'LOTUS',
  'ZEEKR',
  'LYNKCO', 'LYNKANDCO',
]);

export function normaliseMake(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isChineseOem(raw: string | null | undefined): boolean {
  const key = normaliseMake(raw);
  if (!key) return false;
  if (CHINESE_OEM_KEYS.has(key)) return true;
  // Prefix fallbacks for the multi-token / punctuated brands.
  if (key.startsWith('LYNK')) return true;
  if (key.startsWith('GREATWALL')) return true;
  return false;
}
