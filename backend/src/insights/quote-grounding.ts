// ─────────────────────────────────────────────────────────────────────────────
// QUOTE GROUNDING
// Verifies that the LLM-extracted *verbatim* quotes in campaign_answers actually
// appear in the transcript. A fabricated / hallucinated quote shares few tokens
// with any window of the transcript, so we can flag it deterministically — no
// extra model call, no external dependency.
//
// This is a QA trust signal: "not found" is a strong hint the model invented the
// quote (or mis-attributed it), which undermines the whole extracted record.
// ─────────────────────────────────────────────────────────────────────────────

export type QuoteStatus = 'verified' | 'weak' | 'missing';

export interface QuoteGroundingItem {
  field: string; // stable key, e.g. 'view_on_brand' or 'key_competitor_drivers.0'
  label: string; // human-readable
  quote: string;
  status: QuoteStatus;
  score: number; // 0..1 best-window similarity
}

export interface QuoteGrounding {
  checked: number;
  verified: number;
  weak: number;
  missing: number;
  items: QuoteGroundingItem[];
}

// Lowercase, fold smart quotes, strip punctuation, collapse whitespace. ASR text
// and "verbatim" model quotes rarely match on punctuation/casing, so we compare
// on normalized word tokens.
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Best multiset coverage of the quote's tokens within any sliding window of the
// transcript of equal length (order-independent, robust to small ASR slips).
// Returns 0..1 — 1 means a window contains every quote token.
function bestWindowScore(qTokens: string[], tTokens: string[]): number {
  const m = qTokens.length;
  if (m === 0 || tTokens.length === 0) return 0;

  const need = new Map<string, number>();
  for (const t of qTokens) need.set(t, (need.get(t) ?? 0) + 1);

  // Quote longer than the whole transcript: score by total overlap.
  if (m > tTokens.length) {
    const have = new Map<string, number>();
    for (const t of tTokens) have.set(t, (have.get(t) ?? 0) + 1);
    let matched = 0;
    for (const [tok, want] of need) matched += Math.min(want, have.get(tok) ?? 0);
    return matched / m;
  }

  const have = new Map<string, number>();
  let matched = 0;
  const add = (tok: string) => {
    const want = need.get(tok);
    if (want == null) return;
    const cur = have.get(tok) ?? 0;
    if (cur < want) matched++;
    have.set(tok, cur + 1);
  };
  const drop = (tok: string) => {
    const want = need.get(tok);
    if (want == null) return;
    const cur = have.get(tok) ?? 0;
    if (cur <= want) matched--;
    have.set(tok, cur - 1);
  };

  let best = 0;
  for (let i = 0; i < tTokens.length; i++) {
    add(tTokens[i]!);
    if (i >= m) drop(tTokens[i - m]!);
    if (i >= m - 1) {
      const score = matched / m;
      if (score > best) best = score;
      if (best >= 1) break;
    }
  }
  return best;
}

const VERIFIED_THRESHOLD = 0.7;
const WEAK_THRESHOLD = 0.45;

function verifyOne(
  quote: string,
  transcriptNorm: string,
  tTokens: string[],
): { status: QuoteStatus; score: number } | null {
  const stripped = (quote || '').trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  const qNorm = normalize(stripped);
  if (!qNorm) return null; // nothing to verify

  // Fast path: the normalized quote is literally present.
  if (transcriptNorm.includes(qNorm)) return { status: 'verified', score: 1 };

  const qTokens = qNorm.split(' ');
  // Very short quotes can't be strongly verified by overlap alone — if the exact
  // substring check above missed, treat as weak rather than asserting fabrication.
  if (qTokens.length < 3) return { status: 'weak', score: 0.5 };

  const score = bestWindowScore(qTokens, tTokens);
  let status: QuoteStatus;
  if (score >= VERIFIED_THRESHOLD) status = 'verified';
  else if (score >= WEAK_THRESHOLD) status = 'weak';
  else status = 'missing';
  return { status, score };
}

// Quote-bearing fields on a Parity-style campaign_answers object.
const SIMPLE_QUOTE_FIELDS: Array<[string, string]> = [
  ['consent_to_dealer', 'Consent to dealer'],
  ['decision_made', 'Already decided'],
  ['dealer_already_in_touch', 'Dealer in touch'],
  ['affordability_issues', 'Affordability'],
  ['lifestyle_change_vehicle', 'Lifestyle change'],
  ['view_on_brand', 'View: brand'],
  ['view_on_current_vehicle', 'View: current vehicle'],
  ['view_on_dealer', 'View: dealer'],
  ['view_on_finance_agreement', 'View: finance'],
  ['competitor_vehicle', 'Competitor vehicle'],
  ['competitor_reasons', 'Competitor reasons'],
];

export function verifyCampaignQuotes(
  transcriptText: string | null | undefined,
  answers: any,
): QuoteGrounding | null {
  if (!answers || !transcriptText) return null;
  const transcriptNorm = normalize(transcriptText);
  if (!transcriptNorm) return null;
  const tTokens = transcriptNorm.split(' ');

  const items: QuoteGroundingItem[] = [];
  const push = (field: string, label: string, quote: unknown) => {
    if (typeof quote !== 'string') return;
    const res = verifyOne(quote, transcriptNorm, tTokens);
    if (!res) return;
    items.push({
      field,
      label,
      quote: quote.trim(),
      status: res.status,
      score: Math.round(res.score * 100) / 100,
    });
  };

  for (const [key, label] of SIMPLE_QUOTE_FIELDS) push(key, label, answers[key]?.quote);

  if (Array.isArray(answers.key_competitor_drivers)) {
    answers.key_competitor_drivers.forEach((d: any, i: number) =>
      push(`key_competitor_drivers.${i}`, `Driver: ${d?.driver ?? i + 1}`, d?.quote),
    );
  }

  const out: QuoteGrounding = { checked: items.length, verified: 0, weak: 0, missing: 0, items };
  for (const it of items) {
    if (it.status === 'verified') out.verified++;
    else if (it.status === 'weak') out.weak++;
    else out.missing++;
  }
  return out;
}
