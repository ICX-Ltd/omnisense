import type {
  PromptInteractionType,
  PromptKind,
} from '../../db/entities/prompt-template.entity';
import {
  NARRATIVE_GENERIC_TEMPLATE,
  NARRATIVE_CALLS_OPERATIONS_TEMPLATE,
  NARRATIVE_CALLS_CLIENT_SERVICES_TEMPLATE,
  NARRATIVE_CHATS_OPERATIONS_TEMPLATE,
  NARRATIVE_CHATS_CLIENT_SERVICES_TEMPLATE,
  NARRATIVE_SURVEY_ANALYTICS_TEMPLATE,
} from '../../insights/prompt/build-narrative-summary-prompt';

export interface SeedFragment {
  key: string;
  interactionType: PromptInteractionType;
  kind: PromptKind;
  campaign: string | null;
  label: string;
  notes: string | null;
  body: string;
}

// ─── CALL BASE ───────────────────────────────────────────────────────────────

const CALL_BASE = `
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

{{campaign_section}}
{{campaign_qa_section}}
{{campaign_transcript_section}}
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
  }{{campaign_qa_schema}}{{campaign_transcript_schema}},

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
- If a campaign-specific schema extension appears above (e.g. "campaign_answers"
  or "campaign_transcript"), include it in your output as a top-level field.
  Omit it entirely if none was provided.

Transcript:
"""{{transcript}}"""
`.trim();

// ─── CALL CAMPAIGN SECTIONS ──────────────────────────────────────────────────

const CALL_CAMPAIGN_UNKNOWN = `═══════════════════════════════════════
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

const CALL_CAMPAIGN_DEFAULT = `═══════════════════════════════════════
SECTION 2 — CAMPAIGN
═══════════════════════════════════════
Campaign: {{campaign}} (provided — do not detect, set campaign_detected to "{{campaign}}")

Compliance check for {{campaign}}:
  No specific compliance check for this campaign — set all compliance fields to null.

For gdpr dimension: set to null (not applicable for {{campaign}}).`;

function buildKnownCallCampaign(
  campaign: string,
  rule: string,
  gdprApplies: boolean,
): string {
  const gdprNote = gdprApplies
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

const CALL_CAMPAIGN_MFS = buildKnownCallCampaign(
  'MFS',
  `itc_statement_read — was the ITC statement read?
  dpa_3_elements_verified — were address, postcode AND DOB all confirmed?`,
  false,
);

const CALL_CAMPAIGN_MFS_EOC = buildKnownCallCampaign(
  'MFS_EOC',
  'four_options_explained — were the 4 end-of-contract options explained?',
  false,
);

const CALL_CAMPAIGN_NMGB_AO = buildKnownCallCampaign(
  'NMGB_AO',
  'lost_sale_identified — was the lost-sale reason identified?',
  false,
);

const CALL_CAMPAIGN_WINBACK = buildKnownCallCampaign(
  'Winback',
  'six_month_callback_advised — was the 6-month callback advised?',
  true,
);

const CALL_CAMPAIGN_FPI = buildKnownCallCampaign(
  'FPI',
  'fpi_confirmed_with_customer_agreement — was future purchase intention confirmed with customer agreement?',
  true,
);

// ─── CALL: PARITY CAMPAIGN ───────────────────────────────────────────────────
// Equity-Parity Finance Agreement review. Customers identified as being in a
// position to upgrade their vehicle for a comparable monthly payment are
// invited to a dealer review. Goal of the call is to qualify the customer
// and (ideally) get consent to pass details to the dealer.

const CALL_CAMPAIGN_PARITY = `═══════════════════════════════════════
SECTION 2 — CAMPAIGN: PARITY (Equity-Parity Finance Agreement Review)
═══════════════════════════════════════
Campaign: Parity (provided — do not detect, set campaign_detected to "Parity")

About the campaign:
  This is an OUTBOUND campaign targeting customers whose existing finance
  agreement has been identified as a candidate for vehicle upgrade at a
  COMPARABLE monthly payment. The purpose of the call is to invite the
  customer to a review with their dealer.

  The customer's CURRENT vehicle, brand, dealer and finance agreement are
  all relevant — the agent's job is to qualify whether the customer is open
  to a review, and (if so) to capture consent to pass details to the dealer.

  From the ADVISOR's perspective, no finance element is discussed — the call
  is simply an invitation to an account review where the customer can discuss
  a new car purchase. The dealer can value their car and organise a test drive.

Compliance check for Parity:
  No campaign-specific compliance script applies — set all fields in
  campaign_compliance (itc_statement_read, dpa_3_elements_verified,
  four_options_explained, lost_sale_identified, six_month_callback_advised,
  fpi_confirmed_with_customer_agreement, contacted_by_dealership) to null,
  EXCEPT contacted_by_dealership which MAY be set from the customer's own
  answer when explicitly stated (matches campaign Q&A item dealer_already_in_touch).

For gdpr dimension: set to null (not applicable for Parity).`;

const CALL_CAMPAIGN_PARITY_QA = `═══════════════════════════════════════
SECTION 2B — CAMPAIGN Q&A (PARITY)
═══════════════════════════════════════
Extract the CUSTOMER's position on each item below from the transcript only.
Listen for what the customer actually says — not what the agent claims on
their behalf.

EVERY answer is "yes" or "no". If a topic is never raised, the answer is "no".
For each item below the listed INDICATORS are signals that — when the customer
raises them — make the answer "yes". They are examples to guide you, not an
exhaustive checklist.

For every item, return an object matching the campaign_answers schema below.
Every "quote" field MUST be a verbatim, ≤20-word excerpt from the CUSTOMER's
speech that justifies the answer. If no quote is available, set quote to "".

Q&A items:

1. consent_to_dealer
   Did the customer AGREE to have their details passed to the dealer?
   answer: "yes" | "no"

2. view_on_brand
   Did the customer express a NEGATIVE view of their CURRENT brand?
   answer: "yes" | "no"
   Indicators (any → "yes"): reliability issues; poor driving experience;
   cost / value; warranty; recall and/or repair; poor part-exchange value.
   summary: ≤30 words capturing the negative view (or "" if answer is "no")

3. view_on_current_vehicle
   Did the customer express a NEGATIVE view of their CURRENT vehicle?
   answer: "yes" | "no"
   Indicators (any → "yes"): reliability issues / breakdowns; poor driving
   experience; running cost / value; warranty; recall and/or repair; poor
   part-exchange value.
   summary: ≤30 words capturing the negative view (or "" if answer is "no")

4. view_on_dealer
   Did the customer express a NEGATIVE view of their CURRENT dealer?
   answer: "yes" | "no"
   Indicators (any → "yes"): poor customer experience; poor service; poor
   communication; lack of a local dealer / location; general frustration.
   summary: ≤30 words capturing the negative view (or "" if answer is "no")

5. view_on_finance_agreement
   Did the customer express a NEGATIVE view of their CURRENT finance agreement?
   answer: "yes" | "no"
   Indicators (any → "yes"): monthly payments too high / too expensive; poor
   communication or customer experience; commission disclosure concerns;
   negative press / information; future value / negative equity.
   summary: ≤30 words capturing the negative view (or "" if answer is "no")

6. decision_made
   Did the customer say they have ALREADY decided what they are going to do?
   answer: "yes" | "no"
   Indicators (any → "yes"): keep the car; hand the car back; change brand;
   buy the car outright / pay off existing finance; refinance; go elsewhere.
   detail: ≤30 words on what they have decided (or "" if answer is "no")

7. affordability_issues
   Did the customer say they have AFFORDABILITY issues that have affected, or
   will affect, their decision?
   answer: "yes" | "no"
   detail: ≤30 words (or "" if answer is "no")

8. lifestyle_change_vehicle
   Have there been LIFESTYLE changes that affect the customer's vehicle or
   financial position?
   answer: "yes" | "no"
   Indicators (any → "yes"): growing family / new dependants / children;
   retirement; new commute / working from home; mobility needs; job change;
   income change / redundancy.
   detail: ≤30 words (or "" if answer is "no")

9. dealer_already_in_touch
   Did the customer say the DEALER had ALREADY been in touch about their
   agreement / upgrade ahead of this call?
   answer: "yes" | "no"
   quote required if "yes".

10. competitor_vehicle
    Did the customer disclose that they are CONSIDERING, or have already
    purchased, a COMPETITOR brand's product?
    answer: "yes" | "no"
    competitor_brand: <brand name> | null
    competitor_model: <model name> | null
    Indicator (→ "yes"): any mention of a brand other than their current one
    in relation to a recent or future purchase.

11. competitor_reasons
    If the customer is looking at a competitor (Q10 = "yes"), WHY are they
    more interested in the competitor's product than this client's brand and
    vehicles? This is the headline insight for this campaign.
    reasons: a list drawn from
      ["price", "monthly_payment", "spec", "ev_or_hybrid", "incentives",
       "range_or_efficiency", "feature", "reliability", "brand_preference",
       "dealer_experience", "part_exchange_value", "timing", "availability",
       "other"]
      ("part_exchange_value" covers a better part-exchange offer from either
       the competitor or dissatisfaction with the current brand's offer.)
    detail: ≤50 words synthesising the reasoning in the customer's own terms.

Also produce a SHORT, RANKED list of headline competitor drivers across the call:

  key_competitor_drivers: array of objects (max 5), each:
    {
      "driver": <short label, e.g. "Higher monthly cost">,
      "explanation": <≤30 words: why this drove the customer>,
      "quote": <≤20 word verbatim customer quote>
    }

If the customer is NOT considering a competitor, set key_competitor_drivers = [].`;

const CALL_CAMPAIGN_PARITY_QA_SCHEMA = `"campaign_answers": {
    "consent_to_dealer":          { "answer": "yes" | "no", "quote": string },
    "view_on_brand":              { "answer": "yes" | "no", "summary": string, "quote": string },
    "view_on_current_vehicle":    { "answer": "yes" | "no", "summary": string, "quote": string },
    "view_on_dealer":             { "answer": "yes" | "no", "summary": string, "quote": string },
    "view_on_finance_agreement":  { "answer": "yes" | "no", "summary": string, "quote": string },
    "decision_made":              { "answer": "yes" | "no", "detail": string, "quote": string },
    "affordability_issues":       { "answer": "yes" | "no", "detail": string, "quote": string },
    "lifestyle_change_vehicle":   { "answer": "yes" | "no", "detail": string, "quote": string },
    "dealer_already_in_touch":    { "answer": "yes" | "no", "quote": string },
    "competitor_vehicle":         { "answer": "yes" | "no", "competitor_brand": string | null, "competitor_model": string | null, "quote": string },
    "competitor_reasons":         { "reasons": string[], "detail": string, "quote": string },
    "key_competitor_drivers": [
      { "driver": string, "explanation": string, "quote": string }
    ]
  }`;

// ─── CALL: NMGB SURVEY CAMPAIGN ──────────────────────────────────────────────
// Post-interaction survey for Nissan Motor GB. Structured tick-box answers are
// written to campaign_answers_json by the survey feed backfill
// (sql/nmgb_survey_backfill.sql) — NOT by the LLM. The LLM's job here is to mine
// the TRANSCRIPT for the qualitative signal the survey misses, written to a
// SEPARATE column (campaign_transcript_json) so the backfill never clobbers it.

const CALL_CAMPAIGN_NMGB_SURVEY = `═══════════════════════════════════════
SECTION 2 — CAMPAIGN: NMGB SURVEY (Nissan Motor GB post-interaction survey)
═══════════════════════════════════════
Campaign: NMGB Survey (provided — do not detect, set campaign_detected to "NMGB Survey")

About the campaign:
  This is an OUTBOUND satisfaction / market-intelligence SURVEY call. The
  customer recently enquired about — or was in market for — a Nissan vehicle and
  MAY have purchased elsewhere. The agent works through a fixed survey script;
  the customer's answers reveal why they did or did not buy a Nissan, who they
  bought instead, and how they rate the dealer experience.

  A separate structured survey feed already records the tick-box answers, so no
  agent-compliance script applies here. The value of THIS analysis is the
  qualitative, verbatim voice-of-customer in Section 2C.

Compliance check for NMGB Survey:
  No campaign-specific compliance script applies — set all fields in
  campaign_compliance to null.

For gdpr dimension: set to null (not applicable for NMGB Survey).`;

const CALL_CAMPAIGN_NMGB_SURVEY_TRANSCRIPT = `═══════════════════════════════════════
SECTION 2C — CAMPAIGN TRANSCRIPT INSIGHTS (NMGB SURVEY)
═══════════════════════════════════════
This is a POST-INTERACTION SURVEY call for Nissan Motor GB (NMGB). The customer
recently enquired about / was in market for a Nissan and MAY have bought
elsewhere. A separate structured survey already records tick-box answers; your
job here is to extract from the TRANSCRIPT ONLY the richer, qualitative signal
the survey cannot capture — especially verbatim voice-of-customer, BALANCED
positives and negatives, and any competitor make/model the survey left blank.

Rules:
- Use the CUSTOMER's words, not the agent's. Never infer beyond what is said.
- Every "quote" MUST be a verbatim, ≤20-word excerpt from the CUSTOMER. If none
  is available, set quote to "".
- "sentiment" values: "positive" | "negative" | "mixed" | "neutral" | "not_expressed".
- Capture positives AND negatives — do not default to negatives only.
- If a topic is never raised, use "not_expressed" / "no" / empty [] as
  appropriate. Never fabricate to fill a field.

Items:

1. current_brand_sentiment
   The customer's view of NISSAN as a brand.
   positives / negatives: short phrases (≤10 words each) drawn from what they say.

2. current_vehicle_sentiment
   The customer's view of their CURRENT / most recent NISSAN vehicle (or the
   Nissan model they enquired about).

3. dealer_sentiment
   The customer's view of the NISSAN DEALER / dealership experience. This adds
   verbatim colour to the survey's numeric dealership rating.

4. competitor_considered
   Did the customer mention CONSIDERING, test-driving, or BUYING a non-Nissan
   vehicle? (→ "yes" for any of these — not only completed purchases.)
   For each brand named, return:
     brand:          <brand name as said>
     model:          <model name> | null
     is_chinese_oem: true if it is a Chinese or Chinese-owned brand (MG, BYD,
                     Omoda, Jaecoo, GWM / Great Wall, ORA, Xpeng, Leapmotor,
                     Zeekr, Lynk & Co, and Geely-owned Volvo, Polestar, Lotus,
                     Smart), else false.
     status:         "considered" | "test_drove" | "purchased"
   IMPORTANT: recover make AND model even when only mentioned in passing — this
   is a primary goal, as the survey often has these blank.

5. competitor_reasons
   WHY the competitor appealed more than Nissan. Choose all that apply from this
   controlled list (aligned to the survey's "influenced_by" factors so they
   chart on the same axes):
     ["apr_lower", "better_value", "brand_loyalty", "colour_spec_pref",
      "comfortable_interior", "customer_service", "discount", "drive_of_vehicle",
      "enhanced_features", "longer_warranty", "monthly_payments_lower",
      "powertrain_options", "pref_design", "quicker_delivery", "size",
      "try_different", "other"]
   chinese_specific_reasons: subset that specifically explains a CHINESE OEM's
     appeal (e.g. price, spec-for-money, EV range). [] if not applicable.
   detail: ≤50 words synthesising the reasoning in the customer's own terms.

6. why_not_nissan
   In the customer's OWN words, why the Nissan option lost — even if not framed
   as a competitor comparison (e.g. price, availability, dealer, spec, EV doubts).

7. frustrations
   Every distinct frustration the customer expresses. For each:
     theme:              short label (e.g. "Long delivery wait")
     severity:           "low" | "medium" | "high"
     root_cause_owner:   "dealer" | "brand" | "finance" | "product" | "process" | "external"
     resolvable:         "yes" | "no" | "partial"  (could NMGB realistically fix it?)
     recommended_action: ≤25 words — what NMGB could do to resolve / prevent it
     quote:              ≤20-word verbatim
   [] if none expressed.

8. ev_sentiment
   Stance on EV / hybrid / charging (the survey only has a single "no interest
   in EVs" flag).
     stance:  "positive" | "negative" | "mixed" | "not_applicable"
     drivers: short phrases explaining the stance (range, charging, cost, etc.)

9. price_expectation_gap
   Did the customer cite a specific price / monthly-payment expectation or a gap
   vs what Nissan offered?  answer: "yes" | "no"; detail ≤30 words.

10. loyalty_signal
    Would they consider Nissan again / recommend it?
      answer:    "likely" | "unlikely" | "conditional" | "unknown"
      condition: if "conditional", what would have to change (≤20 words), else "".

11. dealer_follow_up
    Did the dealer PROACTIVELY follow up after the enquiry / visit?
      answer: "yes" | "no" | "unknown"

12. key_quotes
    Up to 5 of the most report-worthy verbatim customer quotes across the call,
    each: { theme, quote (≤20 words), sentiment }.

13. survey_gaps_filled
    Short strings noting anything the transcript revealed that the tick-box
    survey would have missed or gotten wrong — e.g.
    "Competitor make blank in survey; transcript reveals BYD Seal",
    "Rated dealer highly but transcript shows frustration with follow-up".`;

const CALL_CAMPAIGN_NMGB_SURVEY_TRANSCRIPT_SCHEMA = `"campaign_transcript": {
    "current_brand_sentiment":   { "sentiment": string, "positives": string[], "negatives": string[], "quote": string },
    "current_vehicle_sentiment": { "sentiment": string, "positives": string[], "negatives": string[], "quote": string },
    "dealer_sentiment":          { "sentiment": string, "positives": string[], "negatives": string[], "quote": string },
    "competitor_considered": {
      "answer": "yes" | "no",
      "brands": [
        { "brand": string, "model": string | null, "is_chinese_oem": boolean, "status": "considered" | "test_drove" | "purchased" }
      ],
      "quote": string
    },
    "competitor_reasons":    { "reasons": string[], "chinese_specific_reasons": string[], "detail": string, "quote": string },
    "why_not_nissan":        { "detail": string, "quote": string },
    "frustrations": [
      { "theme": string, "severity": "low" | "medium" | "high", "root_cause_owner": string, "resolvable": "yes" | "no" | "partial", "recommended_action": string, "quote": string }
    ],
    "ev_sentiment":          { "stance": string, "drivers": string[], "quote": string },
    "price_expectation_gap": { "answer": "yes" | "no", "detail": string, "quote": string },
    "loyalty_signal":        { "answer": string, "condition": string, "quote": string },
    "dealer_follow_up":      { "answer": string, "quote": string },
    "key_quotes": [
      { "theme": string, "quote": string, "sentiment": string }
    ],
    "survey_gaps_filled": string[]
  }`;

// ─── CHAT BASE ───────────────────────────────────────────────────────────────

const CHAT_BASE = `
You are an expert analyst for a UK automotive contact centre handling live chat interactions.
Extract structured insights from the chat transcript below.
Return ONLY valid JSON matching the schema exactly. No markdown, no extra keys, no commentary.
{{campaign_line}}
{{idle_rule_section}}
═══════════════════════════════════════
SECTION 1 — CONTACT & CONVERSATION
═══════════════════════════════════════
contact_disposition:
  "connected"   → customer engaged and conversation took place
  "abandoned"   → customer left before agent responded meaningfully
  "bot_only"    → no live agent involved
  "unknown"

conversation_type: lead_generation | sales_follow_up | satisfaction_check | complaint_handling | service_query | other | unknown
{{opportunity_section}}
{{operations_section}}
{{qa_section}}
{{objection_section}}
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

  "opportunity": {
    "is_opportunity": boolean | null,
    "not_opportunity_reason": string | null,
    "reason_detail": string | null
  },

  "customer_signals": {
    "interest_level": string,
    "objections": string[],
    "decision_timeline": string | null,
    "next_step_agreed": string | null
  },

  {{operations_schema}}{{qa_schema}}{{objection_schema}},

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
- opportunity: only populate for campaigns with opportunity classification rules. For other campaigns, set all three fields to null.

Chat Transcript:
"""{{transcript}}"""
`.trim();

// NOTE: chat response-time metrics used to live here as the "chat.response_time"
// + "chat.response_time_schema" prompt fragments. The LLM was unreliable at
// timestamp pairing, so the feature now runs deterministically in code —
// see backend/src/insights/chat-response-time.ts. The two prompt fragments
// have been removed from the SEED_FRAGMENTS array below; existing DB rows
// are deactivated by the migration in backend/sql/.

// ─── CHAT OPERATIONS (default / non-RAC) ─────────────────────────────────────

const CHAT_OPERATIONS_DEFAULT = `═══════════════════════════════════════
SECTION 2 — OPERATIONS SCORING (chats)
═══════════════════════════════════════
Score each dimension 1–10 using these band rules:
  9–10 = "exceptional"
  7–8  = "good"
  5–6  = "average"  (also applies to: SGB marketing preference message missing; wrap form minor error)
  0    = "fail"     (also applies to: Jardine online booking link not signposted; SGB marketing not completed; no wrap form)
  ≤4   = "below_average"

── SCORING PRECONDITION (read before scoring any dimension below) ──
Only score each dimension based on behaviour the conversation gave the agent
the chance to perform. If the customer became unresponsive, ended the chat
early, or otherwise prevented the agent from completing a scoring action
(paraphrase close, wrap form, Jardine booking link, SGB marketing preference,
final summary, expected follow-up questions), DO NOT mark the agent down for
the missing action.

When the agent had NO fair opportunity to perform a scoreable action for a
given dimension, return the dimension as "not applicable" by setting:
  • "score" to null
  • "band" to null
  • "rationale" to a short explanation that the customer did not give the
    agent the opportunity (e.g. "Customer disengaged before agent could
    reach close" or "Customer sent only two short replies — insufficient
    to assess questioning quality").

Dimensions returned as null are EXCLUDED from the overall_score average,
so this does not unfairly inflate or deflate the agent's score.

Do NOT use a mid-band score (e.g. 5) as a substitute for n/a. Only assign
a numeric score when you have evidence to judge the agent's performance on
that specific dimension.

Specific dimensions most affected by this precondition:
  • questioning — do not dock for unasked follow-ups if the customer gave
    no opportunity (short, late, or absent replies). If the conversation
    ended too early to fairly assess questioning quality, set to null.
  • product_process — do not apply the "Fail (0)" band for a missing wrap
    form, booking link, or SGB step if the customer ended the chat before
    the agent could reach that step in the normal flow. If the process was
    interrupted by the customer, set the dimension to null rather than
    scoring it against steps that were never reachable.
  • engagement — "all responses acknowledged" refers to the customer's
    actual responses, not hypothetical ones the customer never sent. If
    the customer produced almost no content to engage with, set to null.
  • paraphrase_close — only score against the "summary/recap" criteria if
    the conversation reached a natural closing point. If the customer
    disengaged before that, set to null rather than using the "Below
    Average: no summary" band for a close that was never possible.

When in doubt between assigning a low score and returning null, prefer
null if the low score would be driven by absence (customer did not engage)
rather than by a concrete agent error (something the agent said or did wrong).

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
  { "score": number | null, "band": string | null, "rationale": string (max 25 words) }

Use "score": null and "band": null when the dimension cannot be fairly
assessed (see SCORING PRECONDITION above). Null dimensions are excluded
from overall_score.

── SCORING FLAGS (emit inside the operations block) ──

After scoring, also emit these flags so reviewers can spot records needing
attention even when the overall_score looks fine:

  partial_scoring: boolean
    true if ONE OR MORE dimensions were set to null (n/a) under the
    SCORING PRECONDITION. Signals that overall_score is based on fewer
    than the full set of dimensions and should not be compared directly
    with records scored on all dimensions.

  partial_scoring_reason: string | null
    if partial_scoring is true, a short explanation (max 30 words) of
    which dimensions are null and why — e.g. "Customer disengaged after
    2 messages; questioning, paraphrase_close, contact_details not
    assessable." null if partial_scoring is false.

  low_score_alert: boolean
    true if ANY individual dimension received a score of 4 or below
    ("below_average" or "fail" band). This surfaces records where a
    single dimension performed poorly even when the average is
    acceptable (e.g. 9s across the board with a 1 on tone).

  low_score_dimensions: string[]
    list of dimension keys with score ≤ 4 (e.g. ["tone", "disclaimer"]).
    Empty [] if low_score_alert is false.
`;

const CHAT_OPERATIONS_SCHEMA_DEFAULT = `"operations": {
    "scores": {
      "response_time":    null,
      "accept_time":      null,
      "questioning":      { "score": number | null, "band": string | null, "rationale": string },
      "product_process":  { "score": number | null, "band": string | null, "rationale": string },
      "engagement":       { "score": number | null, "band": string | null, "rationale": string },
      "tone":             { "score": number | null, "band": string | null, "rationale": string },
      "paraphrase_close": { "score": number | null, "band": string | null, "rationale": string },
      "language_accuracy":{ "score": number | null, "band": string | null, "rationale": string },
      "contact_details":  { "score": number | null, "band": string | null, "rationale": string },
      "correct_outcome":  { "score": number | null, "band": string | null, "rationale": string }
    },
    "overall_score": number,
    "scoring_flags": {
      "partial_scoring": boolean,
      "partial_scoring_reason": string | null,
      "low_score_alert": boolean,
      "low_score_dimensions": string[]
    },
    "coaching": {
      "did_well": string[],
      "needs_improvement": string[],
      "good_quotes": string[],
      "bad_quotes": string[]
    }
  }`;

// ─── CHAT RAC-SPECIFIC ──────────────────────────────────────────────────────

const CHAT_RAC_IDLE_RULE = `
═══════════════════════════════════════
SECTION — INTERACTION SCOPING (RAC)
═══════════════════════════════════════

Two rules apply globally to this conversation and take precedence over any later
section that suggests the agent should chase, follow up, or re-engage after silence.

── RULE 1: BOT vs HUMAN AGENT HANDOVER ──

The opening "Agent:" messages in the transcript are sent by an automated bot,
not the human colleague being scored. The handover marker is the substring:

    "You are now connected to"

All "Agent:" messages BEFORE that marker are bot messages. Do NOT score them
against the colleague in any section (operations, QA assessment, or objection
handling). Coaching quotes, did_well/needs_improvement and rationales must
only reference messages sent AFTER the handover marker.

If the handover marker is not present in the transcript, treat the entire
"Agent:" stream as the human colleague (best effort).

── RULE 2: IDLE HANDLING (3-MINUTE CUSTOMER SILENCE) ──

Transcripts include per-message timestamps (minute granularity). Use them to
classify customer silences relative to the last customer message:

  Active window  → customer silence < 3 minutes
  Idle           → customer silence ≥ 3 minutes (customer has not responded)

WITHIN the Active window (< 3 min since the last customer message):
  • Agent may re-engage, clarify, progress the conversation, offer support,
    or introduce the discount link.
  • Re-engagement opportunities ARE coachable.

ONCE the chat has entered Idle (≥ 3 min since the last customer message):
  • The agent is instructed NOT to chase, re-open, or send prompts purely
    to revive the chat.
  • DO NOT record any missed opportunity, objection-handling failure, or
    coaching item purely because the agent failed to re-engage after Idle.
  • This is considered outside agent control.

EXCEPTION — quality of the final message BEFORE Idle:
  If the agent's last message before the chat entered Idle was weak, vague,
  or failed to progress the sales opportunity or address a customer objection,
  coaching MAY still apply — but ONLY against the quality of that final
  message, never against "failure to re-engage."

Coachable examples (use these as anchors):

  Example 1 — Weak progression question
    Agent: "How are you getting on with things?"
    Coachable against: questioning / engagement (weak progression).
    NOT coachable against: failure to re-engage after Idle.

  Example 2 — Missed decision-delay objection
    Customer: "I think I'll leave it for now."
    Agent (weak): "No problem."
    Coachable against: objection.think_about_it_consult (failed to explore
      hesitation or introduce the discount link BEFORE Idle).
    NOT coachable against: failure to chase after Idle.

  Example 3 — Missed price objection
    Customer: "AA is cheaper."
    Agent (weak): "That's the best price we can offer."
    Coachable against: objection.price_value (failed to reframe value or
      apply discount link BEFORE Idle).
    NOT coachable against: failure to re-engage after Idle.

── SCOPE ──

Apply these rules when scoring:
  • operations.engagement, operations.paraphrase_close, operations.contact_details,
    operations.questioning, operations.product_process
  • qa_assessment Q4 (next steps clear) and Q11 (needs established)
  • objection categories: post_link_drop_off, low_engagement,
    think_about_it_consult, channel_preference, future_purchase_intent
  • generic_checklist.progressed_next_step

Does NOT apply to objection.time_delay — that dimension is about AGENT
response speed, not customer silence.
`;

const CHAT_RAC_OPPORTUNITY = `
═══════════════════════════════════════
SECTION — RAC SALES OPPORTUNITY CLASSIFICATION
═══════════════════════════════════════
This campaign sells RAC breakdown cover to NEW customers. Classify whether this chat
represents a genuine opportunity to sell a new policy.

═══════════════════════════════════════
MINIMUM INTENT THRESHOLD (CRITICAL FILTER)
═══════════════════════════════════════
A chat must demonstrate CONFIRMED or EXPRESSED customer intent beyond the
initial bot interaction to qualify as an opportunity.

The following on their own are NOT sufficient to qualify as a sales opportunity:

  • Selecting or typing "Buying breakdown cover" in the bot
  • Opening a chat and asking to go to the website only
  • Greetings only ("hi", "hello")
  • Partial, unclear, misspelled, or fragmented messages without follow-up
  • Providing name/email only without any product or purchase discussion
  • Not responding to the human agent after handover

If the customer does NOT engage with the human agent AND does NOT express a
clear buying, pricing, product, or payment intent in their own words:

  → is_opportunity = NULL
  → not_opportunity_reason = NULL
  → reason_detail explaining that intent could not be confirmed due to lack of engagement.

CRITICAL:
Do NOT classify as TRUE based on bot-stage intent alone.

═══════════════════════════════════════
── DECISION ORDER ──
═══════════════════════════════════════
Apply these rules IN ORDER. The first rule that matches decides the outcome.

  1. If the customer expresses a clear POSITIVE intent to buy, restart, set up,
     pay for, or complete NEW breakdown cover at any point in the conversation
     → is_opportunity = TRUE.

  2. OVERRIDE RULE — NEW SALE JOURNEY AFTER SERVICE / LAPSE SIGNAL

     If ANY "not-opportunity" identifier appears earlier (e.g. existing_policy,
     recent_policy_lapse), BUT the customer later clearly engages in a NEW
     purchase or sign-up journey, classify as:

     → is_opportunity = TRUE

     This includes:
       • asking how to buy or restart cover
       • asking about cover types before purchase
       • asking about multi-person / personal cover before purchase
       • asking how to pay or complete purchase
       • asking how to use Tesco Clubcard vouchers or codes
       • confirming that cover has been purchased or set up

     CRITICAL:
     Later confirmed sales intent OVERRIDES earlier service/lapse signals.

  3. If NO positive sales intent is present AND ANY "not-opportunity"
     identifier below applies → is_opportunity = FALSE.
     Pick the single most dominant identifier as not_opportunity_reason.

  4. If neither a not-opportunity identifier NOR a clear positive intent
     signal is present (e.g. customer disengaged before stating intent,
     transcript too short, intent genuinely ambiguous)
     → is_opportunity = NULL, not_opportunity_reason = NULL,
       reason_detail explaining why intent could not be determined.

CRITICAL:
Do NOT default to is_opportunity = TRUE merely because no negative
identifier fired. Absence of negatives is NOT positive intent.

If unsure between FALSE and NULL, prefer NULL when intent is not clearly expressed.

═══════════════════════════════════════
── POSITIVE SIGNALS (required for is_opportunity = TRUE) ──
═══════════════════════════════════════
At least ONE of these must be clearly present in customer messages
AFTER initial bot interaction AND demonstrate active engagement:

  • asks for a quote, price, or "how much" for breakdown cover
  • compares RAC against a competitor while shopping for cover
    (e.g. "AA quoted me X, can you beat it?") AND no membership signal
  • states they currently have no breakdown cover and is enquiring about getting some
  • asks about levels/tiers of cover, family cover, or add-ons before holding a policy
  • mentions buying cover for a vehicle they don't yet have cover on
  • asks how to take out / sign up / start a NEW policy
  • asks how to use Tesco Clubcard vouchers, voucher codes, discount codes,
    or promo codes to buy RAC breakdown cover
  • asks how to pay for membership or complete purchase
  • confirms they have bought / signed up / completed cover during the chat

NOT VALID positive signals on their own:

  • "Buying breakdown cover" (bot selection)
  • "I just want to get on your website"
  • greetings only
  • unclear or fragmented input without follow-up

If the customer is ONLY asking for a phone number, a service, an account
change, documents, or help with an existing policy/breakdown — that is
NOT a positive signal, even if RAC products are mentioned in passing.

═══════════════════════════════════════
── NOT-OPPORTUNITY IDENTIFIERS ──
═══════════════════════════════════════
Set is_opportunity = false and use the matching key as not_opportunity_reason.
If multiple apply, pick the dominant intent.

Apply these ONLY if no positive new-sale intent is present OR the conversation
remains purely service-based.

"existing_policy"
  The customer is or behaves as a current RAC member.
  Triggers (any one is sufficient):
    • "I'm a member" / "I have RAC" / "I'm with the RAC" / "I'm covered by you"
    • "my cover" / "my policy" / "my membership" / "my plan"
    • supplies a membership number, policy number, or customer reference
    • mentions logging into the RAC app or account
    • asks about adding a vehicle, driver, or upgrading existing cover
    • references benefits they already hold (e.g. "my joining gift", "my free months")
    • asks about claims, documents, certificates, or invoices for cover they hold

"recent_policy_lapse"
  The customer had a policy that ended/expired/was cancelled within the
  last ~60 days and has not yet restarted.
  Triggers:
    • "my cover ended last week / last month"
    • "I cancelled recently and want to..."
    • "lapsed" / "expired" referencing a recent date
    • returning ex-member referencing their previous cover

"renewal_enquiry"
  The customer is looking to renew an EXISTING policy.
  Triggers:
    • "due for renewal" / "renewing" / "my renewal"
    • "my policy ends on..." asking about continuing
    • renewal price discussion for cover they already hold
    • received a renewal letter / email and is querying it

"cancellation_enquiry"
  The customer wants to cancel or stop an existing policy.
  Triggers:
    • "I want to cancel" / "stop my policy" / "end my cover"
    • "cancel direct debit" / "stop the payment"
    • complaint-driven cancellation request

"policy_update"
  The customer wants to change details on an EXISTING policy/account.
  Triggers:
    • change of address / change of vehicle / change of payment method
    • update personal details (name, phone, email, bank)
    • "I need to update my..." referring to held cover
    • adding or removing a named driver / second vehicle on existing plan

"opt_out"
  The customer is requesting communication preferences changes or data
  removal.
  Triggers:
    • "stop emailing me" / "unsubscribe" / "opt out"
    • "remove my data" / GDPR / Subject Access Request
    • marketing-preference change

"breakdown_report"
  The customer is dealing with a live or recent breakdown, OR is trying to
  reach the breakdown assistance line, OR is asking how to report a breakdown.
  Triggers:
    • "I've broken down" / "my car won't start" / "stranded" / "at the roadside"
    • "where is the recovery truck?" / "ETA on my recovery?"
    • follow-up or chase on an open breakdown case
    • asks for the BREAKDOWN NUMBER / breakdown phone number / breakdown
      assistance number / recovery number / "the number to call when I break down"
    • "how do I report a breakdown?" / "who do I call if I break down?"
    • asks for the contact number used in an emergency / on the roadside

"phone_line_complaint"
  The customer cannot reach RAC by phone or is complaining about
  call-centre wait times.
  Triggers:
    • "I've been on hold for X minutes"
    • "no one answers the phone" / "can't get through" / "kept on hold"
    • "your phone lines are awful"

"myrac_enquiry"
  The customer is asking about MyRAC — the online account portal or app.
  Triggers:
    • can't log in to MyRAC / RAC app
    • password reset / locked out of MyRAC
    • "where do I find X in MyRAC"
    • app errors, missing documents in MyRAC, registration issues

═══════════════════════════════════════
Return:
═══════════════════════════════════════
"opportunity": {
  "is_opportunity": boolean | null,
  "not_opportunity_reason": string | null,
  "reason_detail": string | null
}
`;

const CHAT_RAC_QA = `═══════════════════════════════════════
SECTION — QA ASSESSMENT (campaign-specific)
═══════════════════════════════════════
In addition to the standard operations scoring above, evaluate the colleague
against the following campaign-specific QA questions.
Return results in a separate "qa_assessment" object.
For each question return: { "answer": "yes" | "no" | "n/a", "rationale": string (max 30 words) }

Answer "n/a" ONLY when the question genuinely does not apply to this interaction
(e.g. Q13 vulnerability — only if no vulnerability indicators are present;
Q15 product eligibility — only if no sale took place).

── CORRECT PROCESS (Q1–Q4) ──

Q1  "Was the colleague polite and friendly throughout the conversation?
     - Good grammar and language
     - Good representation of the RAC brand
     - Written communication was well-structured with good quality content and accurate"

Q2  "Was the information provided clear and easy to understand?
     - No jargon used
     - Written communication clear, fair and not misleading
     - Product information was accurate
     - Examples used were easily relatable to the customer"

Q3  "Was all information provided clear and accurate?
     - Canned responses were relevant
     - Ad-hoc conversations were accurate and appropriate"

Q4  "Was the customer clear on what would happen next?
     - Relevant timelines provided"

── EXPECTED SERVICE STANDARD (Q5–Q8) ──

Q5  "Was the colleague polite and friendly throughout the conversation?
     - Good grammar and language
     - Good representation of the RAC brand"

Q6  "Was the information provided on how to use the services clear and easy to understand?
     - No RAC jargon"

Q7  "Was the customer clear on what would happen next?
     - Relevant timelines"

Q8  "Was all information provided clear and accurate?
     - Canned responses were relevant
     - Ad-hoc conversations were accurate and appropriate
     - Free Loyalty Rewards
     - Relevant offer information e.g. free months on monthly
     - Documents via email
     - MyRAC information
     - Relevant contact numbers"

── RIGHT OUTCOME (Q9–Q15) ──

Q9  "Did the colleague accurately confirm identification verification?
     - Relevant ID verification completed"

Q10 "Has all information provided been clear, fair and not misleading?
     - Important terms and conditions relating to products were accurate
     - Information provided did not mislead the member
     - Relevant confirmation language provided i.e. if changes have or have not been made"

Q11 "Was the customer's demands and needs established?"

Q12 "Did the colleague act in the best interest of the member?
     - No undue pressure was applied"

Q13 "If the member was vulnerable, was this identified and handled accordingly?
     - The colleague made suitable adjustments within the conversation"

Q14 "Has the colleague represented the RAC brand well?"

Q15 "Was the customer sold products which the customer is eligible to use?"

After answering all questions, compute scores on a 0–10 scale (to 2 decimal places):
  correct_process_score   = (count of Q1–Q4 answered "yes" / count of Q1–Q4 NOT "n/a") * 10, rounded to 2dp
  service_standard_score  = (count of Q5–Q8 answered "yes" / count of Q5–Q8 NOT "n/a") * 10, rounded to 2dp
  right_outcome_score     = (count of Q9–Q15 answered "yes" / count of Q9–Q15 NOT "n/a") * 10, rounded to 2dp
  overall_score           = (count of ALL Q1–Q15 answered "yes" / count of ALL NOT "n/a") * 10, rounded to 2dp

── SCORING FLAGS (emit inside the qa_assessment block) ──

After computing section and overall scores, also emit these flags so
reviewers can spot records needing attention even when the overall looks
acceptable:

  partial_scoring: boolean
    true if ONE OR MORE questions were answered "n/a" (whether because
    the criterion genuinely did not apply, e.g. Q13 vulnerability with no
    indicators present, or because the customer did not give the agent
    the opportunity). Signals that overall_score is computed over fewer
    than all 15 questions.

  partial_scoring_reason: string | null
    if partial_scoring is true, short explanation (max 30 words) listing
    which questions were n/a and why — e.g. "Q4, Q11, Q15 n/a: customer
    disengaged before agent could confirm next steps, establish needs,
    or complete a sale." null if partial_scoring is false.

  low_score_alert: boolean
    true if ANY question was answered "no" (regardless of section averages).
    Surfaces single-question failures that section averages can mask —
    e.g. 14 "yes" answers and one "no" on Q12 (best interest) should still
    flag as a concern.

  low_score_questions: string[]
    list of question keys answered "no" (e.g. ["q4_next_steps_clear",
    "q12_best_interest"]). Empty [] if low_score_alert is false.
`;

const CHAT_RAC_QA_SCHEMA = `"qa_assessment": {
    "scores": {
      "correct_process": {
        "q1_polite_friendly":       { "answer": string, "rationale": string },
        "q2_clear_understandable":  { "answer": string, "rationale": string },
        "q3_accurate_info":         { "answer": string, "rationale": string },
        "q4_next_steps_clear":      { "answer": string, "rationale": string },
        "section_score": number
      },
      "service_standard": {
        "q5_polite_friendly":       { "answer": string, "rationale": string },
        "q6_services_clear":        { "answer": string, "rationale": string },
        "q7_next_steps_clear":      { "answer": string, "rationale": string },
        "q8_accurate_info":         { "answer": string, "rationale": string },
        "section_score": number
      },
      "right_outcome": {
        "q9_id_verification":       { "answer": string, "rationale": string },
        "q10_fair_not_misleading":  { "answer": string, "rationale": string },
        "q11_needs_established":    { "answer": string, "rationale": string },
        "q12_best_interest":        { "answer": string, "rationale": string },
        "q13_vulnerability":        { "answer": string, "rationale": string },
        "q14_brand_representation": { "answer": string, "rationale": string },
        "q15_eligible_products":    { "answer": string, "rationale": string },
        "section_score": number
      }
    },
    "overall_score": number,
    "scoring_flags": {
      "partial_scoring": boolean,
      "partial_scoring_reason": string | null,
      "low_score_alert": boolean,
      "low_score_questions": string[]
    },
    "coaching": {
      "did_well": string[],
      "needs_improvement": string[],
      "good_quotes": string[],
      "bad_quotes": string[]
    }
  }`;

const CHAT_RAC_OBJECTION = `
═══════════════════════════════════════
SECTION — OBJECTION HANDLING ASSESSMENT (campaign-specific)
═══════════════════════════════════════
Evaluate the customer chat for objections and how the agent handled them.
Return results in a separate "objection_assessment" object.

── OBJECTION CATEGORIES ──

For EACH of the 13 categories below, determine whether the customer raised
that type of objection during the conversation. Use the triggers to help
identify each category. For every category return:
  {
    "raised": boolean,
    "best_practice_followed": boolean | null,   (null if not raised)
    "could_do_more": boolean | null,            (null if not raised)
    "comment": string                           (if raised: max 50 words justifying the three flags above; if not raised: "Not raised")
  }

Category keys and identification guidance:

1. price_value
   Description: Customer challenges price or perceived value.
   Triggers: compares with competitor pricing; requests discount or better price;
   questions value vs cost; mentions previous cheaper quote; indicates price is a barrier.
   Agent should: acknowledge comparison; apply discount link early; reframe value vs
   competitors; keep control of the sale.

2. incentive_offer
   Description: Customer expects additional perks, vouchers or offers.
   Triggers: asks about vouchers or rewards; references competitor incentives; expects
   additional benefits beyond price; queries "offers" specifically; hesitates due to
   lack of extras.
   Agent should: acknowledge expectation; reframe RAC value — mention exclusive perks;
   position discount as immediate benefit.

3. time_delay
   Description: Customer is frustrated with speed and/or waiting.
   Triggers: highlights slow responses; mentions waiting too long; appears frustrated
   with pace; sends follow-ups like "hello?"; drops engagement due to delay.
   Agent should: apologise and reassure; speed up process; summarise and move forward.

4. think_about_it_consult
   Description: Customer delays decision-making or wants to consult others.
   Triggers: delays decision without clear reason; mentions discussing with partner/family;
   avoids committing after quote; indicates future return intention; uses soft exit language.
   Agent should: while the chat is still Active (<3 min customer silence),
   explore hesitation, create urgency, and offer support (including introducing
   the discount link). Failure to re-engage AFTER the chat has entered Idle is
   NOT coachable — see SECTION — INTERACTION SCOPING.

5. channel_preference
   Description: Customer prefers to call or email over chat.
   Triggers: requests phone contact; asks to move away from chat; shows discomfort with
   chat process; requests callback or number; indicates preference for another channel.
   Agent should: respect request; attempt to retain in chat; offer quicker alternative.

6. post_link_drop_off
   Description: Customer disengages after a link is sent.
   Triggers: no response after link is sent while still Active; customer disengages
   mid-journey; stops replying after CTA; does not confirm completion.
   Agent should: within the Active window (<3 min customer silence), follow up
   promptly, reassure, and offer help. After the chat has entered Idle,
   re-engagement is NOT expected and must NOT be scored against the agent —
   see SECTION — INTERACTION SCOPING.

7. technical_issues
   Description: Issues with system, links, or process.
   Triggers: reports link not working; website errors or blank screens; trouble completing
   purchase; issues entering details; problems with codes or activation.
   Agent should: reassure; offer workaround (but not repetitively); stay with customer.

8. future_purchase_intent
   Description: Customer not ready to purchase yet / upcoming renewal.
   Triggers: wants delayed start date; mentions existing cover end date; not ready to
   purchase today; planning ahead; queries renewal timing.
   Agent should: keep engagement; show value now; offer indicative pricing.

9. independent_customer
   Description: Customer prefers to complete journey alone.
   Triggers: wants to self-serve; declines assistance; prefers to complete journey alone;
   rejects guided support; moves away from agent-led journey.
   Agent should: respect independence; stay present; offer support.

10. confusion_validation
    Description: Customer lacks understanding or seeks reassurance.
    Triggers: asks repeated clarification questions; seeks reassurance on details; appears
    unsure or hesitant; questions accuracy of information; misunderstands product.
    Agent should: simplify; reassure; confirm understanding.

11. low_engagement
    Description: Minimal or delayed responses from customer WHILE STILL ACTIVE.
    Triggers: short or minimal responses; repeatedly delayed but <3min replies;
    lack of questions or interaction; passive behaviour; limited engagement with
    journey — all while the customer is still responding (NOT once the chat is Idle).
    Agent should: re-engage, ask simple questions, add value, and guide the
    conversation WHILE THE CHAT IS ACTIVE. Do NOT mark the agent down for
    non-re-engagement once the chat has entered Idle — see SECTION —
    INTERACTION SCOPING.

12. product_policy_fit
    Description: Customer has specific requirements or constraints.
    Triggers: requires specific policy features; questions eligibility; needs coverage
    clarification; mentions constraints (monthly, business use etc.); requests specific
    configuration.
    Agent should: clarify requirement; match to correct product; reassure suitability.

13. effort_process_friction
    Description: Customer perceives process as complex or inconvenient.
    Triggers: perceives process as too complex; reluctance to complete steps; avoids
    multi-step journeys; mentions inconvenience; expresses difficulty using tech.
    Agent should: reduce perceived effort; offer guided support; emphasise speed.

── GENERIC OBJECTION HANDLING CHECKLIST ──

If ANY objection was raised (at least one category has raised = true), also evaluate
whether the agent followed these six generic best-practice steps. For each, return
true/false. If NO objections were raised, set all six to null.

  acknowledged_concern    — Did the agent acknowledge the customer's concern?
  clarified_reason        — Did the agent clarify the reason behind the objection?
  reframed_value          — Did the agent reframe value based on customer needs?
  offered_solution        — Did the agent offer a solution (e.g. discount link, alternative)?
  maintained_control      — Did the agent maintain control of the conversation?
  progressed_next_step    — Did the agent progress towards a clear next step?

Finally, compute:
  objections_raised_count  — total number of categories where raised = true (0–13)
  checklist_score          — count of checklist items that are true / count of non-null items,
                             as a value from 0.00 to 1.00 (null if no objections raised)
  overall_handling_comment — max 60 words summarising the agent's objection handling performance
`;

const CHAT_RAC_OBJECTION_SCHEMA = `"objection_assessment": {
    "categories": {
      "price_value":             { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "incentive_offer":         { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "time_delay":              { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "think_about_it_consult":  { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "channel_preference":      { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "post_link_drop_off":      { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "technical_issues":        { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "future_purchase_intent":  { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "independent_customer":    { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "confusion_validation":    { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "low_engagement":          { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "product_policy_fit":      { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string },
      "effort_process_friction": { "raised": boolean, "best_practice_followed": boolean | null, "could_do_more": boolean | null, "comment": string }
    },
    "generic_checklist": {
      "acknowledged_concern":  boolean | null,
      "clarified_reason":      boolean | null,
      "reframed_value":        boolean | null,
      "offered_solution":      boolean | null,
      "maintained_control":    boolean | null,
      "progressed_next_step":  boolean | null
    },
    "objections_raised_count": number,
    "checklist_score": number | null,
    "overall_handling_comment": string
  }`;

// ─── CSAT CONTEST ASSESSMENT ─────────────────────────────────────────────────
// Separate pipeline from insights: decide whether a CSAT score should be
// CONTESTED (dissatisfaction outside the final agent's control + good handling)
// or NOT CONTESTED (the final agent materially contributed). Composed as
// csat.base + csat.campaign.<CAMPAIGN> framework + csat.schema.

const CSAT_BASE = `
You are a senior contact-centre quality assessor. A customer left a CSAT (customer
satisfaction) survey after a LIVE CHAT. Your job is NOT to judge whether the
customer was satisfied with the business overall — it is to decide whether the
FINAL live chat agent FAIRLY EARNED the CSAT, and therefore whether the score
should be CONTESTED.

GOLDEN RULE
- CONTEST where the customer's dissatisfaction was OUTSIDE the final live chat
  agent's control AND the agent handled the interaction appropriately.
- DO NOT CONTEST where the final live chat agent materially contributed to the
  dissatisfaction through incorrect advice, poor customer handling, missed
  opportunities, premature signposting, or failure to give meaningful assistance.

SCOPE & PRINCIPLES
- Assess ONLY the final live chat agent. Ignore Virtual Assistant / bot messages,
  survey bot, queue notifications and automated routing, and earlier agents —
  UNLESS the final agent had a reasonable opportunity to recover the interaction
  and failed to take it.
- A correct OUTCOME does not automatically mean correct HANDLING. An agent who
  reaches the right answer but disengages, misses opportunities, signposts
  prematurely or handles the customer poorly is DO NOT CONTEST where that
  materially contributed to dissatisfaction. Conversely an agent who cannot
  resolve the issue is CONTEST where they followed process, gave meaningful
  assistance, and the dissatisfaction was outside their control.
- Survey comments explain WHY the customer was dissatisfied but must NEVER
  override the transcript, customer handling, knowledge verification or material
  contribution. Never infer agent failure without transcript evidence (do not use
  "the agent could have been warmer" type assumptions).
- Benefit of the doubt: where interpretation is genuinely unclear and the agent
  followed process, handled well and did not materially contribute — favour
  CONTEST. Use "unclear" only when you genuinely cannot attribute the cause.

CSAT SURVEY
- Score: {{csat_score}}
- Customer comment: {{csat_comment}}
- Campaign: {{campaign}}

CAMPAIGN CONTEST FRAMEWORK — apply these rules:
{{framework_section}}

OUTPUT
Return ONLY valid JSON matching this schema exactly. No markdown, no extra keys,
no commentary. In "rules_triggered" cite each framework rule by its NAME (the
capitalised label, e.g. "Delay Attribution") — NEVER by a number.
{{schema}}

TRANSCRIPT:
{{transcript}}
`;

const CSAT_SCHEMA = `{
  "decision": "contest" | "do_not_contest" | "unclear",
  "confidence": number,                    // 0.0-1.0
  "headline": string,                      // one-line summary of the decision
  "dissatisfaction_source": "final_agent" | "previous_agent" | "dealership" | "business" | "product" | "pricing" | "delay" | "customer_behaviour" | "outside_scope" | "unclear",
  "knowledge_verified": boolean | null,    // was the final agent's information/process correct (null if N/A)
  "agent_materially_contributed": boolean, // did the FINAL agent cause or materially worsen the dissatisfaction
  "factors": {
    "meaningful_assistance": "yes" | "no" | "n/a",
    "customer_handling": "good" | "poor" | "n/a",
    "missed_opportunity": boolean,
    "premature_signposting": boolean,
    "sales_or_enquiry_progressed": "yes" | "no" | "n/a",
    "delay_within_agent_control": boolean | null,
    "closure_appropriate": boolean | null,
    "customer_abusive": boolean
  },
  "rules_triggered": string[],             // SHORT DESCRIPTIVE NAMES of the rules that drove the decision (e.g. "Knowledge Verification", "Meaningful Assistance", "Delay Attribution", "Customer Behaviour"). NEVER return rule numbers.
  "evidence_quotes": string[],             // short verbatim quotes from the transcript
  "rationale": string                      // full reasoning, referencing the framework
}`;

const CSAT_RAC = `
RAC New-Membership Live Chat — CSAT Contest Framework. Each rule below has a NAME
(the capitalised label). When you populate "rules_triggered", cite these NAMES —
never a number.

KNOWLEDGE VERIFICATION — Verify the accuracy of the information/process the final
  agent gave against approved RAC knowledge. Incorrect advice or wrong process →
  DO NOT CONTEST. Correct → continue.
FINAL AGENT ONLY — Assess only from the point the customer is connected to the
  final agent. Judge an earlier failure only via the final agent's reasonable
  opportunity to recover (correct wrong info, answer unanswered questions,
  meaningfully assist). Had the opportunity and failed → DO NOT CONTEST.
OUT OF SCOPE — Enquiries outside New Membership (existing-policy amendments,
  existing-membership queries, renewals, cancellations, membership admin,
  insurance, app/login, complaints, current breakdown assistance, Tesco Clubcard
  voucher issues). Default → CONTEST, PROVIDED the agent correctly explained the
  limitation, used the appropriate approved response / PDC (minor wording
  differences are fine if intent, department and guidance are correct) and offered
  an appropriate next step. BUT DO NOT CONTEST if the agent gave incorrect info,
  handled poorly, or could reasonably have assisted further before referring.
MEANINGFUL ASSISTANCE — (does not require resolving the enquiry) explaining why
  they cannot help, answering what they can, giving relevant info before
  signposting, exploring requirements, ensuring next steps are understood. Failure
  to provide it → DO NOT CONTEST.
CUSTOMER HANDLING — ownership, empathy, professionalism, engagement, clarity,
  accuracy, attempts to assist, appropriate questioning, quality and closure.
  Correct information alone is NOT good handling. Poor handling → DO NOT CONTEST.
MISSED OPPORTUNITY — failing to explore needs, answer answerable questions,
  explain options, continue the sales journey, or prematurely signposting →
  DO NOT CONTEST. For Business Cover, requirements must be explored before
  recommending/ signposting or → DO NOT CONTEST.
TESCO CLUBCARD — purchases/renewals are online-only; agents cannot complete them
  but should explain the process, give the correct link, answer questions and
  offer to take the customer through the quote journey. Meaningful assistance →
  CONTEST. Only a link with little/no engagement → DO NOT CONTEST.
TECHNICAL ISSUES — reasonable attempt to assist (clarify, ask questions, basic
  troubleshooting) before referring. Immediate signposting → DO NOT CONTEST.
CUSTOMER BEHAVIOUR — abuse/threats/offensive/discriminatory/harassment while the
  agent stayed professional → CONTEST.
CUSTOMER EXPECTATIONS — matters outside the agent's control (RAC pricing where
  options explored, company policy, waiting/product limitations/availability,
  website/system limits, another department's decision, eligibility, T&Cs) →
  CONTEST provided handling was appropriate.
CLOSURE — appropriate closure after meaningful assistance → continue. Abrupt/
  premature closure without reasonable assistance → DO NOT CONTEST. Customer ends
  after appropriate assistance → CONTEST; leaves due to poor handling → DO NOT
  CONTEST.
IDLE — reasonable assistance already given before it went idle → CONTEST; little/
  none → DO NOT CONTEST. Agents need not repeatedly re-engage.
DELAY ATTRIBUTION — delays outside the agent's control (queue/phone/patrol times,
  system performance, another department) → CONTEST; delay directly caused by the
  agent → DO NOT CONTEST.
`;

const CSAT_LITHIA = `
Talk & Lithia — CSAT Decision Framework (read alongside the ICX QMF). A QMF
opportunity alone does NOT make a CSAT non-contestable; there must be clear
evidence the handling issue CAUSED or MATERIALLY CONTRIBUTED to the dissatisfaction.

CORE PRINCIPLE: attribute a negative CSAT to the agent only with clear evidence
the agent's handling caused/ materially worsened it. If attribution is unclear →
CONTEST. Assess the whole conversation, not isolated messages. The customer's own
survey comments are the strongest evidence but are not used in isolation.

PROCESS: (1) Is the customer dissatisfied in a way attributable to the agent? If
not → CONTEST. (2) Identify the source (chat agent / dealership / wider business /
vehicle / repair / finance / previous experience / policy / outside control).
(3) Did the agent cause or materially worsen it? If not → CONTEST.

CONTEST where dissatisfaction is NOT the agent's handling, including:
- Pre-existing dissatisfaction (previous dealership experience, complaints,
  vehicle faults, repairs, warranty decisions, finance issues, delivery delays,
  broken promises) where the agent handled appropriately.
- Dealership failures (not answering phones, no callback, poor communication/
  repairs, delays, wrong work, sales-process failures, finance settlements,
  handovers, vehicle issues).
- Business limitations (no appointments/courtesy cars, vehicle unavailable,
  finance declined, warranty exclusions, price expectations, policy) where the
  agent explained the limitation and gave an appropriate next step.
- Information requiring dealership confirmation (price negotiation, offer
  acceptance, transfers, courtesy-car/appointment availability, repair/service
  progress, goodwill, compensation, dealership decisions) — explained + referred
  appropriately.
- Customer disagreeing with CORRECT information given within process.

NOT CONTESTED where the agent's handling caused/materially contributed, e.g.:
- Response/accept-time breaches within the agent's control that the customer
  complains about (targets: response 30s; accept 10s Talk / 30s Lithia).
- Poor questioning / insufficient probing that stalls the enquiry.
- Incorrect information, failing to follow process, or failing to answer what they
  should reasonably know (unless dealership confirmation is genuinely required).
- Poor engagement (ignored questions, robotic responses, enquiry not addressed).
- Lack of empathy that clearly contributes to dissatisfaction.
- Collecting details (reg/postcode/contact) without context/explanation.
- Weak vehicle-search assistance — not exploring budget, payment, method, make/
  model, fuel, transmission etc.; just pointing to website filters — where this
  causes dissatisfaction. (Active chat volume is a factor but never removes the
  duty to acknowledge, question and progress.)
- Unclear paraphrase/close (who will contact, when, about what).

NEVER infer failure without evidence. "Could have been warmer", "may have felt
frustrated" are NOT sufficient. Final question: did the agent's handling cause or
materially contribute to the dissatisfaction? Yes → do_not_contest. No → contest.
`;

// ─── EXPORTED SEED DATA ──────────────────────────────────────────────────────

export const SEED_FRAGMENTS: SeedFragment[] = [
  {
    key: 'call.base',
    interactionType: 'call',
    kind: 'base',
    campaign: null,
    label: 'Call — base template',
    notes:
      'Placeholders: {{campaign_section}}, {{campaign_qa_section}}, {{campaign_qa_schema}}, {{campaign_transcript_section}}, {{campaign_transcript_schema}}, {{transcript}}. Composer injects the campaign section by campaign name; the qa_section / qa_schema slots are populated only for campaigns that ship a call.campaign.<name>.qa + .qa_schema pair (e.g. Parity), and the transcript_section / transcript_schema slots only for campaigns that ship a call.campaign.<name>.transcript + .transcript_schema pair (e.g. NMGB Survey). The two pairs are independent — a campaign may have either, both, or neither.',
    body: CALL_BASE,
  },
  {
    key: 'call.campaign.unknown',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: null,
    label: 'Call — campaign detection (unknown/none)',
    notes: 'Used when no campaign is supplied or campaign="unknown".',
    body: CALL_CAMPAIGN_UNKNOWN,
  },
  {
    key: 'call.campaign.default',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: null,
    label: 'Call — campaign default (no specific compliance)',
    notes:
      'Fallback when a campaign is supplied but has no dedicated fragment. Placeholder: {{campaign}}.',
    body: CALL_CAMPAIGN_DEFAULT,
  },
  {
    key: 'call.campaign.MFS',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'MFS',
    label: 'Call — MFS campaign section',
    notes: null,
    body: CALL_CAMPAIGN_MFS,
  },
  {
    key: 'call.campaign.MFS_EOC',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'MFS_EOC',
    label: 'Call — MFS_EOC campaign section',
    notes: null,
    body: CALL_CAMPAIGN_MFS_EOC,
  },
  {
    key: 'call.campaign.NMGB_AO',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'NMGB_AO',
    label: 'Call — NMGB_AO campaign section',
    notes: null,
    body: CALL_CAMPAIGN_NMGB_AO,
  },
  {
    key: 'call.campaign.Winback',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'Winback',
    label: 'Call — Winback campaign section',
    notes: null,
    body: CALL_CAMPAIGN_WINBACK,
  },
  {
    key: 'call.campaign.FPI',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'FPI',
    label: 'Call — FPI campaign section',
    notes: null,
    body: CALL_CAMPAIGN_FPI,
  },
  {
    key: 'call.campaign.Parity',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'Parity',
    label: 'Call — Parity campaign section',
    notes:
      'Equity-Parity Finance Agreement review campaign. No compliance script; the headline output is the campaign Q&A (see call.campaign.Parity.qa).',
    body: CALL_CAMPAIGN_PARITY,
  },
  {
    key: 'call.campaign.Parity.qa',
    interactionType: 'call',
    kind: 'qa_section',
    campaign: 'Parity',
    label: 'Call — Parity campaign Q&A',
    notes:
      'Question set extracted into the campaign_answers blob. Composer injects this into the {{campaign_qa_section}} slot of call.base.',
    body: CALL_CAMPAIGN_PARITY_QA,
  },
  {
    key: 'call.campaign.Parity.qa_schema',
    interactionType: 'call',
    kind: 'qa_schema',
    campaign: 'Parity',
    label: 'Call — Parity campaign Q&A schema',
    notes:
      'JSON schema fragment for the campaign_answers field. Composer prefixes ",\\n\\n  " when injecting into the {{campaign_qa_schema}} slot of call.base.',
    body: CALL_CAMPAIGN_PARITY_QA_SCHEMA,
  },
  {
    key: 'call.campaign.NMGB Survey',
    interactionType: 'call',
    kind: 'campaign_section',
    campaign: 'NMGB Survey',
    label: 'Call — NMGB Survey campaign section',
    notes:
      'Nissan Motor GB post-interaction survey. No agent-compliance script; the headline output is the transcript insight blob (see call.campaign.NMGB Survey.transcript).',
    body: CALL_CAMPAIGN_NMGB_SURVEY,
  },
  {
    key: 'call.campaign.NMGB Survey.transcript',
    interactionType: 'call',
    kind: 'transcript_section',
    campaign: 'NMGB Survey',
    label: 'Call — NMGB Survey transcript insights',
    notes:
      'Qualitative voice-of-customer mined from the transcript (positives/negatives, competitor make+model, frustrations, quotes). Extracted into the campaign_transcript blob → campaign_transcript_json (a SEPARATE column from campaign_answers_json, which the survey feed backfill owns). Composer injects this into the {{campaign_transcript_section}} slot of call.base.',
    body: CALL_CAMPAIGN_NMGB_SURVEY_TRANSCRIPT,
  },
  {
    key: 'call.campaign.NMGB Survey.transcript_schema',
    interactionType: 'call',
    kind: 'transcript_schema',
    campaign: 'NMGB Survey',
    label: 'Call — NMGB Survey transcript insights schema',
    notes:
      'JSON schema fragment for the campaign_transcript field. Composer prefixes ",\\n\\n  " when injecting into the {{campaign_transcript_schema}} slot of call.base.',
    body: CALL_CAMPAIGN_NMGB_SURVEY_TRANSCRIPT_SCHEMA,
  },
  {
    key: 'chat.base',
    interactionType: 'chat',
    kind: 'base',
    campaign: null,
    label: 'Chat — base template',
    notes:
      'Placeholders: {{campaign_line}}, {{idle_rule_section}}, {{opportunity_section}}, {{operations_section}}, {{qa_section}}, {{objection_section}}, {{operations_schema}}, {{qa_schema}}, {{objection_schema}}, {{transcript}}. (Chat response-time metrics are computed in code, not via the LLM.)',
    body: CHAT_BASE,
  },
  {
    key: 'chat.rac.idle_rule',
    interactionType: 'chat',
    kind: 'other',
    campaign: 'RAC',
    label: 'Chat — RAC interaction scoping (bot handover + idle rule)',
    notes:
      'Global rules for RAC chats: bot-vs-human handover detection via "You are now connected to" marker, plus 3-minute idle handling. Read by the model before any scoring section so it acts as an override.',
    body: CHAT_RAC_IDLE_RULE,
  },
  {
    key: 'chat.operations.default',
    interactionType: 'chat',
    kind: 'operations_section',
    campaign: null,
    label: 'Chat — operations scoring (default)',
    notes: null,
    body: CHAT_OPERATIONS_DEFAULT,
  },
  {
    key: 'chat.operations_schema.default',
    interactionType: 'chat',
    kind: 'operations_schema',
    campaign: null,
    label: 'Chat — operations schema (default)',
    notes: null,
    body: CHAT_OPERATIONS_SCHEMA_DEFAULT,
  },
  {
    key: 'chat.rac.opportunity',
    interactionType: 'chat',
    kind: 'opportunity_section',
    campaign: 'RAC',
    label: 'Chat — RAC opportunity classification',
    notes: null,
    body: CHAT_RAC_OPPORTUNITY,
  },
  {
    key: 'chat.rac.qa',
    interactionType: 'chat',
    kind: 'qa_section',
    campaign: 'RAC',
    label: 'Chat — RAC QA assessment (Q1–Q15)',
    notes: null,
    body: CHAT_RAC_QA,
  },
  {
    key: 'chat.rac.qa_schema',
    interactionType: 'chat',
    kind: 'qa_schema',
    campaign: 'RAC',
    label: 'Chat — RAC QA schema',
    notes: null,
    body: CHAT_RAC_QA_SCHEMA,
  },
  {
    key: 'chat.rac.objection',
    interactionType: 'chat',
    kind: 'objection_section',
    campaign: 'RAC',
    label: 'Chat — RAC objection handling',
    notes: null,
    body: CHAT_RAC_OBJECTION,
  },
  {
    key: 'chat.rac.objection_schema',
    interactionType: 'chat',
    kind: 'objection_schema',
    campaign: 'RAC',
    label: 'Chat — RAC objection handling schema',
    notes: null,
    body: CHAT_RAC_OBJECTION_SCHEMA,
  },

  // ─── NARRATIVE / EXECUTIVE-BRIEFING PROMPTS ──────────────────────────────────
  // These are NOT composed via call.base / chat.base. They are standalone prompts
  // used by the "Generate Narrative" flow (insights-summary.service.ts →
  // getNarrativeSummary). The service loads narrative.<narrativeType> and passes
  // the body to the matching build function in
  // backend/src/insights/prompt/build-narrative-summary-prompt.ts, falling back to
  // the hardcoded default when the fragment is absent. Placeholder {{metrics}} is
  // replaced with the pretty-printed aggregated metrics JSON; the survey_analytics
  // prompt additionally uses {{free_text_samples}} for verbatim comment samples.
  {
    key: 'narrative.generic',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — generic exec summary',
    notes: 'Standalone narrative prompt. Placeholder: {{metrics}}.',
    body: NARRATIVE_GENERIC_TEMPLATE,
  },
  {
    key: 'narrative.calls_operations',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — calls operations',
    notes: 'Standalone narrative prompt. Placeholder: {{metrics}}.',
    body: NARRATIVE_CALLS_OPERATIONS_TEMPLATE,
  },
  {
    key: 'narrative.calls_client_services',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — calls client services',
    notes: 'Standalone narrative prompt. Placeholder: {{metrics}}.',
    body: NARRATIVE_CALLS_CLIENT_SERVICES_TEMPLATE,
  },
  {
    key: 'narrative.chats_operations',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — chats operations',
    notes: 'Standalone narrative prompt. Placeholder: {{metrics}}.',
    body: NARRATIVE_CHATS_OPERATIONS_TEMPLATE,
  },
  {
    key: 'narrative.chats_client_services',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — chats client services',
    notes: 'Standalone narrative prompt. Placeholder: {{metrics}}.',
    body: NARRATIVE_CHATS_CLIENT_SERVICES_TEMPLATE,
  },
  {
    key: 'narrative.survey_analytics',
    interactionType: 'shared',
    kind: 'other',
    campaign: null,
    label: 'Narrative — NMGB survey analytics (Nissan competitive briefing)',
    notes:
      'Standalone narrative prompt for the survey-analytics executive briefing. Placeholders: {{metrics}} (aggregated survey metrics) and {{free_text_samples}} (verbatim comments).',
    body: NARRATIVE_SURVEY_ANALYTICS_TEMPLATE,
  },

  // ── CSAT contest assessment ──────────────────────────────────────────────
  {
    key: 'csat.base',
    interactionType: 'chat',
    kind: 'csat_base',
    campaign: null,
    label: 'CSAT — base assessor template',
    notes:
      'Placeholders: {{csat_score}}, {{csat_comment}}, {{campaign}}, {{framework_section}} (the csat.campaign.<NAME> framework), {{schema}} (csat.schema), {{transcript}}.',
    body: CSAT_BASE,
  },
  {
    key: 'csat.schema',
    interactionType: 'chat',
    kind: 'csat_schema',
    campaign: null,
    label: 'CSAT — output JSON schema',
    notes: 'Shared JSON schema for the CSAT contest decision.',
    body: CSAT_SCHEMA,
  },
  {
    key: 'csat.campaign.RAC',
    interactionType: 'chat',
    kind: 'csat_framework',
    campaign: 'RAC',
    label: 'CSAT — RAC contest framework',
    notes:
      'RAC New-Membership Live Chat CSAT contest rules. Edit here to refine; paste the full framework text if needed.',
    body: CSAT_RAC,
  },
  {
    key: 'csat.campaign.LITHIA',
    interactionType: 'chat',
    kind: 'csat_framework',
    campaign: 'LITHIA',
    label: 'CSAT — Talk & Lithia contest framework',
    notes:
      'Talk & Lithia CSAT decision framework (read alongside the ICX QMF). Key the campaign to match the interaction.campaign value in your data (rename/duplicate as needed).',
    body: CSAT_LITHIA,
  },
  {
    key: 'csat.campaign.default',
    interactionType: 'chat',
    kind: 'csat_framework',
    campaign: null,
    label: 'CSAT — default/fallback framework',
    notes:
      'Used when no csat.campaign.<CAMPAIGN> fragment matches the interaction campaign. Generic contest logic based on the golden rule.',
    body: CSAT_LITHIA,
  },
];
