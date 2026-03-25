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
