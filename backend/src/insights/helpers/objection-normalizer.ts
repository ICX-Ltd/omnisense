export interface ObjectionBucket {
  bucket: string;
  label: string;
  keywords: string[];
}

export const OBJECTION_BUCKETS: ObjectionBucket[] = [
  {
    bucket: 'WRONG_PERSON_OR_BAD_DATA',
    label: 'Wrong Person / Bad Data',
    keywords: [
      'wrong party', 'wrong person', 'wrong number', 'wrong dealer', 'wrong model',
      'wrong location', 'not the intended party', 'incorrect phone number',
      'no nissan ownership', 'accidental inquiry', 'bad timing', 'unfamiliar with caller',
    ],
  },
  {
    bucket: 'CONTACT_OR_PRIVACY_CONCERN',
    label: 'Contact / Privacy Concern',
    keywords: [
      'scam', 'fraud', 'suspicious', 'verification', 'data protection', 'privacy',
      'refused dob', 'refused data verification', 'unwilling to verify', 'unknown caller',
      'unwanted contact', 'repeated calls', 'repeated unwanted calls', 'spam',
    ],
  },
  {
    bucket: 'NO_INTEREST',
    label: 'No Interest',
    keywords: [
      'not interested', 'no interest', 'no purchase intent', 'no need',
      'not looking', 'not planning to change', 'no wish to change vehicle',
      'no vehicle change', 'no upgrade interest', 'not wanting to change the car',
    ],
  },
  {
    bucket: 'TIMING',
    label: 'Timing',
    keywords: [
      'too early', 'bad time', 'at work', 'work schedule',
      'no time', 'not ready yet', 'later this year', 'next year', 'not now',
      'uncertain timetable', 'post-holiday decision',
    ],
  },
  {
    bucket: 'FINANCIAL',
    label: 'Financial Constraints',
    keywords: [
      'financial', 'affordability', "can't afford", 'budget', 'cost of living',
      'monthly payments', 'high repayments', 'high deposit', 'too costly',
      'higher payments unaffordable', 'financial hardship', 'financial constraints',
    ],
  },
  {
    bucket: 'PRICE_TOO_HIGH',
    label: 'Price Too High',
    keywords: [
      'too expensive', 'price too high', 'overpriced', 'price concern',
      'high price', 'pricing', 'value for money', 'high vehicle prices',
      'dealer pricing too high',
    ],
  },
  {
    bucket: 'NEGATIVE_EQUITY',
    label: 'Negative Equity / Low Trade-in',
    keywords: [
      'negative equity', 'zero equity', 'no equity', 'insufficient equity',
      'part exchange valuation too low', 'low trade-in value', 'balloon payment too high',
      'high final payment', 'car value', 'depreciation', 'poor valuation',
    ],
  },
  {
    bucket: 'KEEP_CURRENT_CAR',
    label: 'Happy with Current Car',
    keywords: [
      'happy with current car', 'happy with current vehicle', 'likes current car',
      'prefers current car', 'keeping current car', 'wants to keep current car',
      'keep current vehicle', 'content with current car', 'satisfied with current vehicle',
      'car is perfect', 'no need to change',
    ],
  },
  {
    bucket: 'PAY_OFF_CURRENT_FINANCE',
    label: 'Wants to Pay Off Current Finance',
    keywords: [
      'pay off current finance', 'pay off current car', 'pay off current agreement',
      'pay off early', 'pay balloon', 'buy current car', 'own outright',
      'final payment', 'settlement figure', 'buyout', 'wants car that\'s paid for',
    ],
  },
  {
    bucket: 'LOW_USAGE_NO_NEED',
    label: 'Low Usage / No Immediate Need',
    keywords: [
      'low mileage', 'low usage', 'not driving much', 'drives only on sunday',
      'vehicle sufficient', 'no immediate need', 'no need for new car',
      'not worth changing', 'doesn\'t make sense to get new car',
    ],
  },
  {
    bucket: 'PRODUCT_MISMATCH',
    label: 'Product Mismatch',
    keywords: [
      'wants something different', 'wrong spec', 'size too big', 'needs smaller car',
      'prefers petrol', 'not interested in electric', 'prefers hybrid',
      'ride quality', 'uncomfortable seats', 'poor visibility', 'missing features',
      'specific model preference', 'product concern', 'design preference',
    ],
  },
  {
    bucket: 'COMPETITOR_OR_OTHER_BRAND',
    label: 'Competitor / Other Brand',
    keywords: [
      'already purchased elsewhere', 'better deal elsewhere', 'preferred vw',
      'preferred toyota', 'wanted bmw', 'kia', 'lexus', 'mercedes', 'tesla',
      'citroen', 'mini', 'seat', 'competitor preference', 'switching to different make',
    ],
  },
  {
    bucket: 'ALREADY_PURCHASED',
    label: 'Already Purchased',
    keywords: [
      'already purchased', 'already upgraded', 'already arranged',
      'already sorted new car', 'recently purchased', 'already bought',
      'already ordered new car', 'found elsewhere',
    ],
  },
  {
    bucket: 'DEALER_EXPERIENCE',
    label: 'Poor Dealer Experience',
    keywords: [
      'poor dealer experience', 'dealer experience', 'dealer unhelpful',
      'pushy sales', 'rude staff', 'poor customer service', 'sexist treatment',
      'bad experience', 'dealer handling', 'unwanted salesperson',
    ],
  },
  {
    bucket: 'SERVICE_OR_REPAIR_ISSUE',
    label: 'Service / Repair Issue',
    keywords: [
      'service issue', 'repair delay', 'vehicle faults', 'unresolved repair',
      'ongoing repair issues', 'service delay', 'faulty vehicle', 'vehicle unreliable',
      'warranty concern', 'recall', 'coolant leak', 'not starting', 'unsafe to drive',
    ],
  },
  {
    bucket: 'COMMUNICATION_OR_FOLLOW_UP',
    label: 'Communication / Follow-up Failure',
    keywords: [
      'no callback', 'lack of response', 'poor communication', 'unresponsive',
      'delayed response', 'no follow-up', 'previous no response', 'missed call promise',
      'phone not answered', 'email ignored', 'transfer dropped',
    ],
  },
  {
    bucket: 'LOCATION_OR_LOGISTICS',
    label: 'Location / Logistics',
    keywords: [
      'distance to dealer', 'dealer too far', 'location inconvenience',
      'vehicle location', 'servicing location impractical', 'unable to attend in person',
      'housebound', 'no local dealer', 'branch closed', 'logistics',
    ],
  },
  {
    bucket: 'WEBSITE_OR_SYSTEM_ISSUE',
    label: 'Website / System Issue',
    keywords: [
      'website issue', 'website error', 'website not working', 'form errors',
      'online booking issue', 'finance calculator issue', 'system down',
      'link not working', 'app booking issue', 'phone system not working',
    ],
  },
  {
    bucket: 'FINANCE_APPROVAL_OR_CREDIT',
    label: 'Finance / Credit Concern',
    keywords: [
      'finance declined', 'credit score', 'credit concern', 'finance eligibility',
      'approval needed', 'bad credit', 'guarantor', 'credit check worry',
    ],
  },
  {
    bucket: 'RETURN_OR_TERMINATION',
    label: 'Return / Termination',
    keywords: [
      'voluntary termination', 'returning vehicle', 'returning car',
      'return car', 'handing car back', 'termination', 'wants to return car',
      'early termination', 'return policy',
    ],
  },
  {
    bucket: 'HEALTH_AGE_OR_MOBILITY',
    label: 'Health / Age / Mobility',
    keywords: [
      'health', 'mobility', 'retired', 'retirement', 'too old',
      'operation', 'medical', 'hospital', 'eyesight', 'driving uncertainty',
      'brain operations',
    ],
  },
  {
    bucket: 'WORK_OR_LIFESTYLE_CHANGE',
    label: 'Work / Lifestyle Change',
    keywords: [
      'work commitments', 'job change', 'company car', 'salary sacrifice',
      'work lease', 'moving house', 'moving country', 'house purchase',
      'new baby', 'family circumstances', 'retiring', 'switching to work scheme',
    ],
  },
  {
    bucket: 'THIRD_PARTY_DECISION',
    label: 'Third-Party Decision Required',
    keywords: [
      'wife', 'husband', 'partner', 'son in law', 'daughter', 'family decision',
      'not decision maker', 'needs to consult', 'third party',
    ],
  },
  {
    bucket: 'NEEDS_MORE_INFO',
    label: 'Needs More Information',
    keywords: [
      'needs quote', 'needs price first', 'needs settlement figure',
      'needs more information', 'needs test drive', 'needs figures',
      'price inquiry only', 'needs service history', 'needs immediate stock info',
    ],
  },
  {
    bucket: 'AVAILABILITY_OR_STOCK',
    label: 'Availability / Stock',
    keywords: [
      'stock availability', 'product unavailable', 'vehicle not listed online',
      'no stock', 'limited availability', 'test drive unavailable',
      'specific car sold', 'waiting for newer model', 'new model release',
    ],
  },
  {
    bucket: 'VEHICLE_OWNERSHIP_CHANGED',
    label: 'Vehicle Ownership Changed',
    keywords: [
      'sold car', 'already sold vehicle', 'no longer owns car',
      'no longer owns vehicle', 'paid off agreement', 'car returned',
      'already returned car',
    ],
  },
];

// Quick lookup: bucket → label
export const BUCKET_LABELS: Record<string, string> = Object.fromEntries(
  OBJECTION_BUCKETS.map((b) => [b.bucket, b.label]),
);

/**
 * Maps a single objection string to one or more bucket codes.
 * Returns ['OTHER'] if nothing matches.
 */
export function normalizeObjection(raw: string): string[] {
  if (!raw?.trim()) return ['OTHER'];

  const text = raw.toLowerCase();

  // Build a word-set for short-keyword boundary checking
  const wordSet = new Set(text.match(/\b\w+\b/g) ?? []);

  const matches = OBJECTION_BUCKETS.filter((rule) =>
    rule.keywords.some((kw) => {
      const kwLower = kw.toLowerCase();
      // Single-word short keywords: require whole-word match to avoid false positives
      if (!kwLower.includes(' ') && kwLower.length <= 5) {
        return wordSet.has(kwLower);
      }
      return text.includes(kwLower);
    }),
  ).map((rule) => rule.bucket);

  return matches.length ? [...new Set(matches)] : ['OTHER'];
}

/**
 * Aggregates an array of { raw, count } rows into bucket totals,
 * sorted descending. Each raw string can map to multiple buckets.
 */
export function aggregateIntoBuckets(
  rows: Array<{ raw: string; count: number }>,
): Array<{ bucket: string; label: string; count: number }> {
  const totals = new Map<string, number>();

  for (const { raw, count } of rows) {
    const buckets = normalizeObjection(raw);
    for (const b of buckets) {
      totals.set(b, (totals.get(b) ?? 0) + count);
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket, count]) => ({
      bucket,
      label: BUCKET_LABELS[bucket] ?? bucket,
      count,
    }));
}
