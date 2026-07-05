export function buildCallsOperationsNarrativePrompt(metrics: unknown): string {
  return `
You are writing an executive narrative for a contact-centre operations manager in UK automotive finance.
You have aggregated agent quality-score data from outbound call reviews.

Return ONLY valid JSON with this schema:
{
  "headline": string,
  "period_summary": string,
  "performance_overview": string,
  "key_strengths": Array<{ "dimension": string, "avg_score": number | null, "observation": string }>,
  "areas_for_improvement": Array<{ "dimension": string, "avg_score": number | null, "observation": string, "suggested_action": string }>,
  "coaching_themes": Array<{ "theme": string, "frequency": number, "recommended_approach": string }>,
  "score_distribution_insight": string,
  "recommended_actions": Array<{ "action": string, "priority": "high"|"medium"|"low", "owner": "ops"|"team_lead"|"agent"|"l_and_d" }>,
  "notes_on_data_quality": string[]
}

Rules:
- Use ONLY the provided data; do not invent numbers.
- Highlight dimensions where average score is below 7 as priority improvement areas.
- Reference specific coaching themes from the top_coaching_needs data.
- Keep concise.
- Return JSON only. No markdown. No explanation.

DATA (JSON):
${JSON.stringify(metrics, null, 2)}
  `.trim();
}

export function buildCallsClientServicesNarrativePrompt(metrics: unknown): string {
  return `
You are writing an executive narrative for a client services manager in UK automotive finance.
You have aggregated market intelligence and lead generation data from outbound calls.

Return ONLY valid JSON with this schema:
{
  "headline": string,
  "period_summary": string,
  "lead_generation_insight": string,
  "market_signals": Array<{ "signal": string, "evidence": string }>,
  "competitor_landscape": Array<{ "competitor": string, "context": string, "risk_level": "high"|"medium"|"low" }>,
  "lost_sale_analysis": string,
  "interest_level_insight": string,
  "dealer_activity_summary": string,
  "recommended_actions": Array<{ "action": string, "priority": "high"|"medium"|"low", "owner": "ops"|"sales"|"product"|"marketing" }>,
  "notes_on_data_quality": string[]
}

Rules:
- Use ONLY the provided data; do not invent numbers.
- Reference specific competitor names and dealer names where present.
- Highlight lost-sale volume and patterns.
- Return JSON only. No markdown. No explanation.

DATA (JSON):
${JSON.stringify(metrics, null, 2)}
  `.trim();
}

export function buildChatsOperationsNarrativePrompt(metrics: unknown): string {
  return `
You are writing an executive narrative for a contact-centre operations manager in UK automotive finance.
You have aggregated agent quality-score data from chat interaction reviews.

Return ONLY valid JSON with this schema:
{
  "headline": string,
  "period_summary": string,
  "performance_overview": string,
  "key_strengths": Array<{ "dimension": string, "avg_score": number | null, "observation": string }>,
  "areas_for_improvement": Array<{ "dimension": string, "avg_score": number | null, "observation": string, "suggested_action": string }>,
  "coaching_themes": Array<{ "theme": string, "frequency": number, "recommended_approach": string }>,
  "score_distribution_insight": string,
  "recommended_actions": Array<{ "action": string, "priority": "high"|"medium"|"low", "owner": "ops"|"team_lead"|"agent"|"l_and_d" }>,
  "notes_on_data_quality": string[]
}

Rules:
- Use ONLY the provided data; do not invent numbers.
- Note chat-specific considerations (written communication, response clarity, tone in text).
- Return JSON only. No markdown. No explanation.

DATA (JSON):
${JSON.stringify(metrics, null, 2)}
  `.trim();
}

export function buildChatsClientServicesNarrativePrompt(metrics: unknown): string {
  return `
You are writing an executive narrative for a client services manager in UK automotive finance.
You have aggregated market intelligence and customer intent data from chat interactions.

Return ONLY valid JSON with this schema:
{
  "headline": string,
  "period_summary": string,
  "lead_generation_insight": string,
  "market_signals": Array<{ "signal": string, "evidence": string }>,
  "competitor_landscape": Array<{ "competitor": string, "context": string, "risk_level": "high"|"medium"|"low" }>,
  "lost_sale_analysis": string,
  "interest_level_insight": string,
  "recommended_actions": Array<{ "action": string, "priority": "high"|"medium"|"low", "owner": "ops"|"sales"|"product"|"marketing" }>,
  "notes_on_data_quality": string[]
}

Rules:
- Use ONLY the provided data; do not invent numbers.
- Note that chat interactions may reflect different customer intent signals than calls.
- Return JSON only. No markdown. No explanation.

DATA (JSON):
${JSON.stringify(metrics, null, 2)}
  `.trim();
}

export function buildSurveyAnalyticsNarrativePrompt(metrics: unknown, freeTextSamples: unknown): string {
  return `
You are preparing a DIRECTOR-LEVEL executive briefing for Nissan (a UK automotive
manufacturer) on competitive loss. The data comes from post-enquiry survey calls to
customers who considered a Nissan vehicle. A "defection" is a customer who bought a
vehicle from another manufacturer instead of Nissan.

You have TWO data sources:
1. AGGREGATED METRICS — counts, percentages and cross-tabulations from the survey answers.
   Key blocks: totals, competitor_purchases (each tagged chinese:true/false),
   chinese_oem (share of defections to Chinese / Chinese-owned OEMs — MG, BYD, OMODA,
   JAECOO, GWM, ORA, XPENG, Leapmotor, Smart, Volvo, Polestar, Lotus, Zeekr, Lynk & Co),
   quarterly_trend (defections and Chinese share by quarter), not_purchase_reasons,
   purchase_influence_factors (what pulled the customer to the competitor),
   model_performance (per enquired Nissan model), dealer_ratings, interest_factors.
2. FREE-TEXT SAMPLES — verbatim customer and agent comments from the same dataset.

Return ONLY valid JSON with this schema:
{
  "headline": string,                                // one-line punchy summary of the competitive picture
  "period_summary": string,                          // one sentence naming the period and dataset size
  "executive_summary": string,                       // one-paragraph, director-level overview
  "headline_metrics": Array<{ "label": string, "value": string }>,  // the 3-5 numbers that matter
  "competitive_landscape": {
    "summary": string,                               // who Nissan is losing customers to
    "top_competitors": Array<{ "brand": string, "losses": string, "is_chinese": boolean, "note": string }>
  },
  "chinese_oem_threat": {
    "summary": string,                               // evidence of increasing consideration
    "current_share": string,                         // e.g. "22% of defections"
    "trajectory": "accelerating"|"stable"|"declining"|"insufficient_data",
    "quarter_on_quarter": Array<{ "quarter": string, "chinese_share": string, "note": string }>,
    "models_most_affected": string[]
  },
  "why_customers_choose_competitors": {
    "overall_reasons": Array<{ "reason": string, "evidence": string }>,
    "chinese_specific_reasons": Array<{ "reason": string, "evidence": string }>,
    "comparison": string                             // how Chinese-OEM reasons differ from the rest
  },
  "model_risk": Array<{ "model": string, "risk": "high"|"medium"|"low", "evidence": string, "top_competitor": string }>,
  "emerging_themes": Array<{ "theme": string, "direction": "increasing"|"decreasing"|"stable", "evidence": string, "sample_quotes": string[] }>,
  "what_nissan_does_well": Array<{ "strength": string, "evidence": string }>,
  "key_risks": Array<{ "risk": string, "commercial_implication": string }>,
  "recommendations": Array<{ "action": string, "rationale": string, "priority": "high"|"medium"|"low", "owner": "product"|"pricing"|"marketing"|"dealer_network"|"client_services" }>,
  "notes_on_data_quality": string[]
}

Rules:
- "headline" and "period_summary" are REQUIRED string fields — always include both.
- Use ONLY the provided data; do not invent numbers, brands or quotes.
- Ground every claim in a metric or a verbatim quote. Quote free text exactly.
- competitive_landscape.top_competitors: rank by loss count; set is_chinese from the data's chinese flag.
- chinese_oem_threat.trajectory: judge from quarterly_trend. If fewer than 2 quarters have
  data, use "insufficient_data" and say so — do not imply a trend that isn't evidenced.
- emerging_themes: IGNORE competitor brand names. Surface underlying themes only
  (e.g. EV/charging concerns, price sensitivity, finance affordability, wanting more
  equipment, delivery times, trust, perceived value). Judge direction from the quarterly
  data and the free-text volume; say "stable" if you cannot evidence a change.
- what_nissan_does_well: draw from interest_factors, high dealer_ratings and positive free text.
- recommendations: 3 to 5, specific and actionable.
- Provide 2-3 verbatim sample_quotes per emerging theme where free text supports it.
- Keep it concise and board-ready. Return JSON only. No markdown. No explanation.

AGGREGATED METRICS (JSON):
${JSON.stringify(metrics, null, 2)}

FREE-TEXT SAMPLES (JSON):
${JSON.stringify(freeTextSamples, null, 2)}
  `.trim();
}

export function buildNarrativeSummaryPrompt(metrics: unknown): string {
  return `
  You are writing an exec narrative for a contact-centre manager in UK automotive finance.
  
  You are given aggregated metrics for a time window plus example calls.
  
  Return ONLY valid JSON with this schema:
  {
    "headline": string,
    "period_summary": string,
    "what_stood_out": string[],
    "operational_funnel": Array<{ "stage": string, "detail": string }>,
    "top_drivers": Array<{ "driver": string, "evidence": string }>,
    "risks_and_compliance": Array<{ "risk": string, "evidence": string, "suggested_action": string }>,
    "recommended_actions": Array<{ "action": string, "priority": "high"|"medium"|"low", "owner": "ops"|"agent"|"product"|"engineering"|"unknown" }>,
    "notes_on_data_quality": string[]
  }
  
  Rules:
  - Use ONLY the provided data; do not invent numbers.
  - Be specific: call out connect rate issues, common conversation types, interest levels, and dealer follow-up volume if present.
  - Reference examples only using the fields provided (recordingId snippets / summaries).
  - Keep concise.
  - Return JSON only. No markdown. No explanation.
  
  DATA (JSON):
  ${JSON.stringify(metrics, null, 2)}
  `.trim();
}
