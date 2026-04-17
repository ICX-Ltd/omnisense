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

function isRacCampaign(campaign?: string | null): boolean {
  return !!campaign && /rac/i.test(campaign);
}

function buildRacOperationsSection(): string {
  return `═══════════════════════════════════════
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
`;
}

function buildRacOperationsSchema(): string {
  return `"qa_assessment": {
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
    "coaching": {
      "did_well": string[],
      "needs_improvement": string[],
      "good_quotes": string[],
      "bad_quotes": string[]
    }
  }`;
}

function buildDefaultOperationsSection(): string {
  return `═══════════════════════════════════════
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
`;
}

function buildDefaultOperationsSchema(): string {
  return `"operations": {
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
  }`;
}

function buildRacObjectionHandlingSection(): string {
  return `
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
   Agent should: explore hesitation; create urgency; offer support.

5. channel_preference
   Description: Customer prefers to call or email over chat.
   Triggers: requests phone contact; asks to move away from chat; shows discomfort with
   chat process; requests callback or number; indicates preference for another channel.
   Agent should: respect request; attempt to retain in chat; offer quicker alternative.

6. post_link_drop_off
   Description: Customer disengages after a link is sent.
   Triggers: no response after link is sent; customer disengages mid-journey; stops
   replying after CTA; does not confirm completion; long silence post-link.
   Agent should: follow up quickly; reassure; offer help.

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
    Description: Minimal or delayed responses from customer.
    Triggers: short or minimal responses; delayed replies; lack of questions or interaction;
    passive behaviour; limited engagement with journey.
    Agent should: re-engage; ask simple questions; add value; guide conversation.

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
}

function buildRacObjectionHandlingSchema(): string {
  return `"objection_assessment": {
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
}

function buildRacOpportunitySection(): string {
  return `
═══════════════════════════════════════
SECTION — RAC SALES OPPORTUNITY CLASSIFICATION
═══════════════════════════════════════
This campaign sells RAC breakdown cover to NEW customers. Classify whether this chat
represents a genuine opportunity to sell a new policy.

is_opportunity: false if ANY of the following apply:
  "existing_policy"       → customer already has an active RAC policy
  "recent_policy_lapse"   → customer had a policy within the last 60 days
  "renewal_enquiry"       → customer is looking to renew an existing policy
  "cancellation_enquiry"  → customer is looking to cancel their policy
  "policy_update"         → customer is looking to update their policy or account details
  "opt_out"               → customer is requesting to opt out of communications
  "breakdown_report"      → customer is reporting or chasing a breakdown incident
  "phone_line_complaint"  → customer is complaining about not being able to get through on phone lines
  "myrac_enquiry"         → customer is asking questions about MyRAC (the online account portal)

is_opportunity: true if NONE of the above apply — i.e. this is a genuine prospect for new breakdown cover.

Return:
  "opportunity": {
    "is_opportunity": boolean,
    "not_opportunity_reason": string | null   (one of the categories above, or null if is_opportunity is true)
    "reason_detail": string | null            (max 50 words explaining the classification)
  }
`;
}

export function buildChatInsightsPrompt(chatTranscript: string, campaign?: string | null): string {
  const campaignLine = campaign && campaign !== 'unknown'
    ? `Campaign context: ${campaign}\n`
    : '';

  const rac = isRacCampaign(campaign);
  const opportunitySection = rac ? buildRacOpportunitySection() : '';
  const qaSection = rac ? buildRacOperationsSection() : '';
  const objectionSection = rac ? buildRacObjectionHandlingSection() : '';
  const qaSchema = rac ? `,\n\n  ${buildRacOperationsSchema()}` : '';
  const objectionSchema = rac ? `,\n\n  ${buildRacObjectionHandlingSchema()}` : '';

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
${opportunitySection}
${buildDefaultOperationsSection()}
${qaSection}
${objectionSection}
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

  ${buildDefaultOperationsSchema()}${qaSchema}${objectionSchema},

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
"""${chatTranscript}"""
`.trim();
}
