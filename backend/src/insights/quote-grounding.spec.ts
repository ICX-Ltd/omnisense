import { verifyCampaignQuotes } from './quote-grounding';

const TRANSCRIPT = `
Agent: Morning, this is a quick courtesy call about your finance agreement.
Customer: To be honest I've been really unhappy with the dealer, they never call me back.
Agent: I'm sorry to hear that. Are you thinking about your next vehicle yet?
Customer: Yeah, I've actually been looking at a Tesla Model 3, the running costs are much lower.
Agent: Understood. And how are the monthly payments feeling at the moment?
Customer: Honestly money's a bit tight right now, the payments are a stretch.
`;

function answersWith(overrides: Record<string, any>) {
  return { consent_to_dealer: { answer: 'yes' }, ...overrides };
}

describe('verifyCampaignQuotes', () => {
  it('returns null without a transcript or answers', () => {
    expect(verifyCampaignQuotes(null, { view_on_dealer: { quote: 'x' } })).toBeNull();
    expect(verifyCampaignQuotes(TRANSCRIPT, null)).toBeNull();
  });

  it('verifies a near-verbatim quote present in the transcript', () => {
    const g = verifyCampaignQuotes(
      TRANSCRIPT,
      answersWith({ view_on_dealer: { answer: 'yes', quote: 'really unhappy with the dealer, they never call me back' } }),
    )!;
    const item = g.items.find((i) => i.field === 'view_on_dealer')!;
    expect(item.status).toBe('verified');
    expect(item.score).toBeGreaterThanOrEqual(0.7);
  });

  it('verifies despite minor ASR/punctuation differences', () => {
    const g = verifyCampaignQuotes(
      TRANSCRIPT,
      answersWith({ competitor_vehicle: { answer: 'yes', quote: "I've been looking at a Tesla Model 3 — the running costs are lower" } }),
    )!;
    expect(g.items.find((i) => i.field === 'competitor_vehicle')!.status).toBe('verified');
  });

  it('flags a fabricated quote as missing', () => {
    const g = verifyCampaignQuotes(
      TRANSCRIPT,
      answersWith({ affordability_issues: { answer: 'yes', quote: 'I just won the lottery so price is no object whatsoever' } }),
    )!;
    const item = g.items.find((i) => i.field === 'affordability_issues')!;
    expect(item.status).toBe('missing');
    expect(g.missing).toBe(1);
  });

  it('skips empty/missing quotes (does not count them)', () => {
    const g = verifyCampaignQuotes(
      TRANSCRIPT,
      answersWith({ view_on_brand: { answer: 'no', quote: '' }, view_on_dealer: { answer: 'no' } }),
    )!;
    expect(g.checked).toBe(0);
  });

  it('checks key_competitor_drivers quotes by index', () => {
    const g = verifyCampaignQuotes(
      TRANSCRIPT,
      answersWith({
        key_competitor_drivers: [
          { driver: 'Running costs', quote: 'the running costs are much lower' },
          { driver: 'Made up', quote: 'the spaceship gets me to work in three minutes flat' },
        ],
      }),
    )!;
    expect(g.items.find((i) => i.field === 'key_competitor_drivers.0')!.status).toBe('verified');
    expect(g.items.find((i) => i.field === 'key_competitor_drivers.1')!.status).toBe('missing');
  });
});
