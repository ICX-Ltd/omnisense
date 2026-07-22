// Prompt for the survey-dataset "Ask AI" assistant. Unlike the per-interaction
// QA, this answers questions about a WHOLE filtered set of survey records, so
// it must count/aggregate precisely from the rows provided (never estimate).
// Output is forced to JSON so it works with every provider's structured extract().

export function buildSurveyQaPrompt(
  question: string,
  rowsBlock: string,
  meta: { considered: number; total: number; truncated: boolean },
): string {
  const truncNote = meta.truncated
    ? `NOTE: the filtered set has ${meta.total} records but only the first ${meta.considered} are shown (size limit). Answer from the shown records and explicitly warn that the set was truncated, so counts are a lower bound.`
    : `All ${meta.total} records matching the filters are shown.`;

  return `
You are a data analyst answering questions about a set of NMGB customer-survey records
that already match the analyst's dashboard filters. Answer the question using ONLY the
records below.

Rules:
- For counting / "how many" / breakdown questions, COUNT PRECISELY from the records. State
  the exact number and the total considered (e.g. "12 of 143 records"). Never estimate or
  extrapolate.
- Ground every statement in the data. Do not invent makes, models, numbers, names or quotes.
  If the data does not support an answer, say so.
- Each record includes the enquired vehicle, dealer, date, the structured survey answers
  (including competitor_purchase = what they actually bought), and the transcript when present.
  "Bought" / defection = survey_answers.competitor_purchase.
- Be concise. Where useful, quote 1-3 short customer comments as evidence.
- ${truncNote}

Return ONLY valid JSON: { "answer": string }

QUESTION:
${question}

SURVEY RECORDS (${meta.considered} of ${meta.total}):
${rowsBlock}
  `.trim();
}
