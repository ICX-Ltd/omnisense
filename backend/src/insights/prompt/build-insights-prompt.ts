// ─────────────────────────────────────────────────────────────────────────────
// CALL INSIGHTS PROMPT
// Audience: Operations (agent scoring) + Client Services (market intelligence)
// ─────────────────────────────────────────────────────────────────────────────

type KnownCampaign = 'MFS' | 'MFS_EOC' | 'NMGB_AO' | 'Winback' | 'FPI';

const CAMPAIGN_COMPLIANCE: Record<KnownCampaign, string> = {
  MFS:      'itc_statement_read — was the ITC statement read?\ndpa_3_elements_verified — were address, postcode AND DOB all confirmed?',
  MFS_EOC:  'four_options_explained — were the 4 end-of-contract options explained?',
  NMGB_AO:  'lost_sale_identified — was the lost-sale reason identified?',
  Winback:  'six_month_callback_advised — was the 6-month callback advised?',
  FPI:      'fpi_confirmed_with_customer_agreement — was future purchase intention confirmed with customer agreement?',
};

const GDPR_CAMPAIGNS = new Set<string>(['Winback', 'FPI']);

function buildCampaignSection(campaign?: string | null): string {
  if (!campaign || campaign === 'unknown') {
    return `═══════════════════════════════════════
SECTION 2 — CAMPAIGN DETECTION
═══════════════════════════════════════
Detect campaign from transcript context. Options:
  "MFS"      → Motor Finance Services (look for: ITC statement, finance agreement discussion)
  "MFS_EOC"  → End of Contract (look for: end of agreement, 4 options, upgrade/return/extend/purchase)
  "NMGB_AO"  → (look for: lost sale references, dealer network queries)
  "Winback"  → (look for: 6-month callback, lapsed customer, returning)
  "FPI"      → Future Purchase Intention (look for: future buying intent, timeline)
  "unknown"  → if cannot be determined

Campaign-specific compliance (only score if campaign matches; otherwise null):
  MFS:      itc_statement_read, dpa_3_elements_verified (address + postcode + DOB)
  MFS_EOC:  four_options_explained
  NMGB_AO:  lost_sale_identified
  Winback:  six_month_callback_advised
  FPI:      fpi_confirmed_with_customer_agreement

For gdpr dimension: only score if Winback or FPI campaign detected; otherwise null.`;
  }

  const rule = CAMPAIGN_COMPLIANCE[campaign as KnownCampaign]
    ?? 'No specific compliance check for this campaign — set all compliance fields to null.';
  const gdprNote = GDPR_CAMPAIGNS.has(campaign)
    ? `For gdpr dimension: score this dimension (campaign is ${campaign}).`
    : `For gdpr dimension: set to null (not applicable for ${campaign}).`;

  return `═══════════════════════════════════════
SECTION 2 — CAMPAIGN
═══════════════════════════════════════
Campaign: ${campaign} (provided — do not detect, set campaign_detected to "${campaign}")

Compliance check for ${campaign}:
  ${rule}

${gdprNote}`;
}

export function buildCallInsightsPrompt(transcript: string, campaign?: string | null): string {
  return `
You are an expert analyst for a UK automotive contact centre handling outbound finance and sales campaigns.
Extract structured insights from the call transcript below.
Return ONLY valid JSON matching the schema exactly. No markdown, no extra keys, no commentary.

═══════════════════════════════════════
SECTION 1 — CONTACT & CONVERSATION
═══════════════════════════════════════
contact_disposition rules (apply strictly):
  "no_answer"              → rings out, no voicemail left
  "voicemail"              → answering machine reached (message left or not)
  "connected_wrong_party"  → answered by someone who is NOT the account holder/intended customer
  "connected_correct_party"→ intended customer reached AND a real conversation takes place
  "busy" / "call_dropped" / "invalid_number" / "unknown" → use only when clearly applicable

If contact_disposition ≠ connected_correct_party:
  - Keep summary_short minimal
  - Leave operations scores null and client_services fields empty
  - Do NOT invent outcomes

conversation_type: lead_generation | sales_follow_up | satisfaction_check | complaint_handling | service_query | other | unknown

${buildCampaignSection(campaign)}

═══════════════════════════════════════
SECTION 3 — OPERATIONS SCORING (calls only)
═══════════════════════════════════════
Score each dimension on a 1–10 scale using these band rules:
  9–10 = "exceptional"    (all elements present + upbeat/warm tone)
  7–8  = "good"           (all elements present, tone flat/robotic)
  5–6  = "average"        (partial elements or rushed/robotic delivery)
  ≤4   = "below_average"  (key elements missing, inappropriate tone, or not attempted)

Dimensions to score:
  intro           → greeting + name + company + customer name
  data_protection → address + DOB (critical elements); postcode if MFS campaign
  campaign_focus  → account review explained + offers given + interest explored + stage ascertained
  disclaimer      → call recording notice given
  gdpr            → see Section 2 for whether to score
  correct_outcome → call outcome accurately matches what happened
  tone_pace       → warmth, pace, audible smile, adaptation to customer
  delivery        → natural vs scripted, brand representation, confidence
  questioning     → open/closed use, buying signals spotted, natural flow
  rapport         → active listening, mirroring, summarising, signposting, empathy
  objection_handling → counters rejections, spots upsell, avoids being pushy
  active_listening   → acknowledges cues, responds to voice/background, avoids repetition
  product_knowledge  → answers product/agreement questions or seeks info appropriately

For correct_outcome: score is 9–10 (correct) or ≤4 (incorrect) only — no middle bands.
For each dimension return:
  { "score": number, "band": string, "rationale": string (max 25 words), "timestamp_ref": string|null }

═══════════════════════════════════════
SECTION 4 — CLIENT SERVICES INTELLIGENCE
═══════════════════════════════════════
  is_in_market_now          → boolean | null
  has_purchased_elsewhere   → boolean | null
  competitor_purchased      → string | null (competitor name if purchased elsewhere)
  lost_sale                 → boolean | null
  lead_generated_for_dealer → boolean
  dealer_supporting_customer→ boolean | null
  dealer_name               → string | null
  contacted_by_dealership   → boolean | null

Blockers to sale (key output for Client Services):
  Extract ALL reasons customer gave for NOT purchasing / not being ready.
  category: competitor_preference | price_concern | timing | product_concern |
            dealer_experience | financial | already_purchased | no_interest | other

Competitor intelligence:
  Any competitor brands, models, or products mentioned. Note context and sentiment.

═══════════════════════════════════════
SECTION 5 — SHARED FIELDS
═══════════════════════════════════════
- summary_short: ≤200 chars, factual
- summary_detailed: full narrative of what happened
- sentiment_overall: -1.0 to 1.0
- customer_signals: interest_level (high|medium|low|unknown), objections[], decision_timeline, next_step_agreed
- action_items: concrete only, derived from transcript
- risk_flags: compliance issues, complaints, data concerns, vulnerable customer signals
- data_quality: is_too_short, is_unclear, overlapping_speech, notes

═══════════════════════════════════════
JSON SCHEMA
═══════════════════════════════════════
{
  "contact_disposition": string,
  "conversation_type": string,
  "campaign_detected": string,
  "summary_short": string,
  "summary_detailed": string,
  "sentiment_overall": number,

  "customer_signals": {
    "interest_level": string,
    "objections": string[],
    "decision_timeline": string | null,
    "next_step_agreed": string | null
  },

  "campaign_compliance": {
    "itc_statement_read": boolean | null,
    "dpa_3_elements_verified": boolean | null,
    "four_options_explained": boolean | null,
    "lost_sale_identified": boolean | null,
    "six_month_callback_advised": boolean | null,
    "fpi_confirmed_with_customer_agreement": boolean | null,
    "contacted_by_dealership": boolean | null
  },

  "operations": {
    "scores": {
      "intro":              { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "data_protection":    { "score": number | null, "band": string | null, "rationale": string, "timestamp_ref": string | null },
      "campaign_focus":     { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "disclaimer":         { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "gdpr":               { "score": number | null, "band": string | null, "rationale": string, "timestamp_ref": string | null },
      "correct_outcome":    { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "tone_pace":          { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "delivery":           { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "questioning":        { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "rapport":            { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "objection_handling": { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "active_listening":   { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null },
      "product_knowledge":  { "score": number, "band": string, "rationale": string, "timestamp_ref": string | null }
    },
    "overall_score": number,
    "coaching": {
      "did_well": string[],
      "needs_improvement": string[],
      "good_quotes": string[],
      "bad_quotes": string[]
    }
  },

  "client_services": {
    "is_in_market_now": boolean | null,
    "has_purchased_elsewhere": boolean | null,
    "competitor_purchased": string | null,
    "lost_sale": boolean | null,
    "lead_generated_for_dealer": boolean,
    "dealer_supporting_customer": boolean | null,
    "dealer_name": string | null,
    "contacted_by_dealership": boolean | null,
    "blockers_to_sale": [
      { "category": string, "description": string, "competitor_mentioned": string | null }
    ],
    "competitor_intelligence": [
      { "brand": string, "context": string, "sentiment": "positive" | "negative" | "neutral" }
    ]
  },

  "action_items": [
    { "description": string, "owner": "agent" | "customer" | "dealer" | "unknown", "due_date_if_mentioned": string | null }
  ],

  "key_entities": [
    { "type": string, "value": string }
  ],

  "risk_flags": string[],

  "data_quality": {
    "is_too_short": boolean,
    "is_unclear": boolean,
    "overlapping_speech": boolean,
    "notes": string
  }
}

Quality rules:
- Use transcript only. Never invent facts.
- Quotes max 12 words. If none, use [].
- overall_score = mean of non-null dimension scores, rounded to 1 decimal place.
- action_items must be concrete. If none, [].
- risk_flags: flag vulnerable customer language, complaints, compliance gaps, or DPA failures.

Transcript:
"""${transcript}"""
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT INSIGHTS PROMPT
// Audience: Operations (agent scoring) + Client Services (market intelligence)
// ─────────────────────────────────────────────────────────────────────────────

export function buildChatInsightsPrompt(chatTranscript: string, campaign?: string | null): string {
  const campaignLine = campaign && campaign !== 'unknown'
    ? `Campaign context: ${campaign}\n`
    : '';

  return `
You are an expert analyst for a UK automotive contact centre handling live chat interactions.
Extract structured insights from the chat transcript below.
Return ONLY valid JSON matching the schema exactly. No markdown, no extra keys, no commentary.
${campaignLine}
Note: Response time and accept time SLAs cannot be measured from transcript text alone — leave those fields null.

═══════════════════════════════════════
SECTION 1 — CONTACT & CONVERSATION
═══════════════════════════════════════
contact_disposition:
  "connected"   → customer engaged and conversation took place
  "abandoned"   → customer left before agent responded meaningfully
  "bot_only"    → no live agent involved
  "unknown"

conversation_type: lead_generation | sales_follow_up | satisfaction_check | complaint_handling | service_query | other | unknown

═══════════════════════════════════════
SECTION 2 — OPERATIONS SCORING (chats)
═══════════════════════════════════════
Score each dimension 1–10 using these band rules:
  9–10 = "exceptional"
  7–8  = "good"
  5–6  = "average"  (also applies to: SGB marketing preference message missing; wrap form minor error)
  0    = "fail"     (also applies to: Jardine online booking link not signposted; SGB marketing not completed; no wrap form)
  ≤4   = "below_average"

Dimensions:
  questioning
    Exceptional: all relevant questions asked, matched to enquiry nature
    Good: questions asked but not all relevant, or only some asked
    Below Average: no relevant questions asked

  product_process
    Exceptional: client process followed; spec/brand questions answered; wrap form correct
    Average (5): basic brand awareness; process not fully followed; minor wrap form error OR SGB marketing preference missing
    Fail (0): no client/ICX process demonstrated; incorrect wrap form; Jardine booking link missing OR SGB marketing not completed

  engagement
    Exceptional: friendly throughout; all responses acknowledged; rapport built
    Good: majority engaging; most responses acknowledged; some rapport
    Below Average: robotic/message-taking; customer responses ignored

  tone
    Exceptional: positive language + empathy shown when needed; rapport built throughout
    Good: positive language used; some missed empathy opportunities
    Below Average: no positive language or empathy

  paraphrase_close
    Exceptional: full summary — team who will contact + recap of information to be discussed
    Good: some but not all summary elements included
    Below Average: no summary

  language_accuracy
    Exceptional: no spelling or grammar mistakes
    Good: fewer than 2 mistakes (if corrected, deduct 2 pts)
    Below Average: 2 or more mistakes

  contact_details
    Exceptional: all contact details obtained; agent followed up on missing elements
    Good: some contact info obtained; missing elements not followed up
    Below Average: no contact details obtained

  correct_outcome
    Exceptional: outcome matches chat content
    Below Average: outcome does not match

For each dimension return:
  { "score": number, "band": string, "rationale": string (max 25 words) }

═══════════════════════════════════════
SECTION 3 — CLIENT SERVICES INTELLIGENCE
═══════════════════════════════════════
  is_in_market_now          → boolean | null
  has_purchased_elsewhere   → boolean | null
  competitor_purchased      → string | null
  lost_sale                 → boolean | null
  lead_generated_for_dealer → boolean
  dealer_supporting_customer→ boolean | null
  dealer_name               → string | null
  contacted_by_dealership   → boolean | null

Blockers to sale:
  category: competitor_preference | price_concern | timing | product_concern |
            dealer_experience | financial | already_purchased | no_interest | other

Competitor intelligence: any competitor brands or models mentioned, with context and sentiment.

═══════════════════════════════════════
JSON SCHEMA
═══════════════════════════════════════
{
  "contact_disposition": string,
  "conversation_type": string,
  "summary_short": string,
  "summary_detailed": string,
  "sentiment_overall": number,

  "customer_signals": {
    "interest_level": string,
    "objections": string[],
    "decision_timeline": string | null,
    "next_step_agreed": string | null
  },

  "operations": {
    "scores": {
      "response_time":    null,
      "accept_time":      null,
      "questioning":      { "score": number, "band": string, "rationale": string },
      "product_process":  { "score": number, "band": string, "rationale": string },
      "engagement":       { "score": number, "band": string, "rationale": string },
      "tone":             { "score": number, "band": string, "rationale": string },
      "paraphrase_close": { "score": number, "band": string, "rationale": string },
      "language_accuracy":{ "score": number, "band": string, "rationale": string },
      "contact_details":  { "score": number, "band": string, "rationale": string },
      "correct_outcome":  { "score": number, "band": string, "rationale": string }
    },
    "overall_score": number,
    "coaching": {
      "did_well": string[],
      "needs_improvement": string[],
      "good_quotes": string[],
      "bad_quotes": string[]
    }
  },

  "client_services": {
    "is_in_market_now": boolean | null,
    "has_purchased_elsewhere": boolean | null,
    "competitor_purchased": string | null,
    "lost_sale": boolean | null,
    "lead_generated_for_dealer": boolean,
    "dealer_supporting_customer": boolean | null,
    "dealer_name": string | null,
    "contacted_by_dealership": boolean | null,
    "blockers_to_sale": [
      { "category": string, "description": string, "competitor_mentioned": string | null }
    ],
    "competitor_intelligence": [
      { "brand": string, "context": string, "sentiment": "positive" | "negative" | "neutral" }
    ]
  },

  "action_items": [
    { "description": string, "owner": "agent" | "customer" | "dealer" | "unknown", "due_date_if_mentioned": string | null }
  ],

  "key_entities": [
    { "type": string, "value": string }
  ],

  "risk_flags": string[],

  "data_quality": {
    "is_too_short": boolean,
    "is_unclear": boolean,
    "notes": string
  }
}

Quality rules:
- Use transcript only. Never invent facts.
- Quotes max 12 words. If none, use [].
- overall_score = mean of scorable (non-null) dimensions, rounded to 1 decimal place.
- action_items must be concrete. If none, [].
- risk_flags: complaints, vulnerable customer signals, data/GDPR concerns, booking link missed.

Chat Transcript:
"""${chatTranscript}"""
`.trim();
}
