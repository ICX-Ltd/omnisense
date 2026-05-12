// Deterministic computation of chat agent response-time metrics from the raw
// transcript text. Replaces the LLM-derived chat_response_metrics field —
// the LLM was unreliable at timestamp pairing, so we parse + walk in code.
//
// Transcript line format expected (Liveperson-style export, one message per
// row, content may continue on following lines until the next timestamp):
//   HH:MM[:SS]-<source>: <content>
// where <source> is one of: consumer | customer | user | agent | visitor

import { ChatResponseMetrics, ChatResponsePair } from './insights.service';

// SLA threshold for a single agent reply. Pairs above this count as a breach.
// Kept here so the threshold travels with the computation/aggregation.
export const CHAT_RESPONSE_SLA_SECONDS = 180;

// Patterns that identify a system-generated nudge / closure warning posted by
// the chat platform itself. Matched anywhere in the message body. Conservative:
// only add patterns that are unambiguously templated chase prompts.
export const AUTO_MESSAGE_PATTERNS: RegExp[] = [
  /haven['']?t heard from you in a while/i,
  /are you still (there|with me|online)/i,
  /this (chat|conversation) will close/i,
  /closing (the|this) chat (now|due to)/i,
  /due to inactivity/i,
  /we will (now )?close this chat/i,
];

// Marker that delimits the bot/handover boundary in RAC chats. Every agent
// line BEFORE this marker (inclusive) is a bot, not the human colleague.
const HANDOVER_MARKER_REGEX = /you are now connected to/i;

const CUSTOMER_LABELS = new Set(['consumer', 'customer', 'user', 'visitor']);

type Source = 'agent' | 'consumer';

interface ParsedLine {
  timestamp: string;        // verbatim, as printed in the transcript
  totalSeconds: number;     // seconds-from-midnight, for arithmetic
  source: Source;
  content: string;          // full content, may contain newlines
}

function parseTimestampToSeconds(ts: string): number | null {
  const m = ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  const sec = m[3] ? parseInt(m[3]!, 10) : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return h * 3600 + min * 60 + sec;
}

// Splits transcript text into ParsedLine[]. Handles both shapes the rest of
// the app stores:
//   1) Plain text: one message per line as "HH:MM[:SS]-<source>: <content>",
//      with continuation lines appended to the previous message.
//   2) JSON array of message objects with shape
//      { source: "Agent"|"Customer"|..., timestamp: ISO-string, content: ... }
export function parseChatTranscript(transcriptText: string): ParsedLine[] {
  if (!transcriptText) return [];

  // JSON array — try this first since well-formed JSON also fails the line
  // regex and would otherwise produce zero lines.
  const trimmed = transcriptText.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = tryParseJsonTranscript(trimmed);
    if (parsed) return parsed;
  }

  return parseLineTranscript(transcriptText);
}

function tryParseJsonTranscript(jsonText: string): ParsedLine[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
    // Some transcripts are double-encoded — a JSON string of JSON. Unwrap.
    if (typeof raw === 'string') raw = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: ParsedLine[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') continue;
    const sourceRaw = String(entry.source ?? '').toLowerCase();
    const source: Source | null =
      sourceRaw === 'agent'
        ? 'agent'
        : CUSTOMER_LABELS.has(sourceRaw)
          ? 'consumer'
          : null;
    if (source === null) continue;

    const tsRaw = entry.timestamp;
    if (typeof tsRaw !== 'string' || !tsRaw) continue;

    // Pull HH:MM:SS out of an ISO timestamp for display; use the full Date
    // for arithmetic so multi-day or cross-midnight chats compute correctly.
    const isoDate = new Date(tsRaw);
    const epochSec = isoDate.getTime();
    if (Number.isNaN(epochSec)) continue;

    const hhmmssMatch = tsRaw.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    const displayTs = hhmmssMatch ? hhmmssMatch[1]! : tsRaw;

    const content =
      typeof entry.content === 'string'
        ? entry.content
        : entry.content == null
          ? ''
          : String(entry.content);

    out.push({
      timestamp: displayTs,
      totalSeconds: Math.floor(epochSec / 1000),
      source,
      content,
    });
  }

  if (out.length === 0) return null;

  // JSON exports aren't always pre-sorted; rely on the ISO timestamp.
  out.sort((a, b) => a.totalSeconds - b.totalSeconds);
  return out;
}

function parseLineTranscript(transcriptText: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lineRegex =
    /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*([A-Za-z]+)\s*:\s*(.*)$/;
  let current: ParsedLine | null = null;
  for (const rawLine of transcriptText.split(/\r?\n/)) {
    const m = rawLine.match(lineRegex);
    if (m) {
      if (current) out.push(current);
      const ts = m[1]!;
      const labelLower = m[2]!.toLowerCase();
      const source: Source | null =
        labelLower === 'agent'
          ? 'agent'
          : CUSTOMER_LABELS.has(labelLower)
            ? 'consumer'
            : null;
      const totalSec = parseTimestampToSeconds(ts);
      if (source === null || totalSec === null) {
        current = null;
        continue;
      }
      current = {
        timestamp: ts,
        totalSeconds: totalSec,
        source,
        content: m[3] ?? '',
      };
    } else if (current && rawLine.trim().length > 0) {
      current.content += '\n' + rawLine;
    }
    // empty / unparseable lines without a current message are dropped
  }
  if (current) out.push(current);
  return out;
}

function isRacCampaign(campaign: string | null | undefined): boolean {
  return !!campaign && /rac/i.test(campaign);
}

function isAutoMessageContent(content: string): boolean {
  // Test against the first 400 chars only — long substantive messages that
  // merely echo a templated phrase later shouldn't trip the filter.
  const head = content.slice(0, 400);
  return AUTO_MESSAGE_PATTERNS.some((p) => p.test(head));
}

function previewOf(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) : oneLine;
}

export type AggregatedChatResponseMetrics = {
  avgSeconds: number | null;
  longestSeconds: number | null;
  lastSeconds: number | null;
  slaBreachCount: number | null;
  measuredCount: number | null;
};

// Rolls the per-turn pair list up into the scalar metrics persisted on
// InteractionInsight (avg, longest, last, SLA breach count, measured count).
export function aggregateChatResponseMetrics(
  metrics: ChatResponseMetrics | undefined | null,
): AggregatedChatResponseMetrics {
  const empty: AggregatedChatResponseMetrics = {
    avgSeconds: null,
    longestSeconds: null,
    lastSeconds: null,
    slaBreachCount: null,
    measuredCount: null,
  };

  if (!metrics || !Array.isArray(metrics.pairs) || metrics.pairs.length === 0) {
    return empty;
  }

  // Only customer→human-agent pairs with a measurable gap contribute to the
  // aggregates. Auto-message diagnostics and unanswered pairs are dropped.
  const realPairs: ChatResponsePair[] = metrics.pairs.filter(
    (p) => p && p.is_auto_message !== true && typeof p.gap_seconds === 'number',
  );

  if (realPairs.length === 0) {
    // We saw pairs but none were measurable — record zeroes so the dashboard
    // can distinguish "no chat" from "chat with all auto-messages / unanswered".
    return {
      avgSeconds: null,
      longestSeconds: null,
      lastSeconds: null,
      slaBreachCount: 0,
      measuredCount: 0,
    };
  }

  const gaps = realPairs.map((p) => p.gap_seconds as number);
  const total = gaps.reduce((acc, g) => acc + g, 0);
  const avg = total / gaps.length;
  const longest = gaps.reduce((acc, g) => (g > acc ? g : acc), gaps[0]!);
  const slaBreachCount = gaps.filter(
    (g) => g > CHAT_RESPONSE_SLA_SECONDS,
  ).length;

  // Last-response time: prefer the pair flagged is_last_pair; otherwise the
  // last measurable pair in document order.
  const flaggedLast = [...realPairs]
    .reverse()
    .find((p) => p.is_last_pair === true);
  const lastPair = flaggedLast ?? realPairs[realPairs.length - 1]!;
  const lastSeconds =
    typeof lastPair.gap_seconds === 'number' ? lastPair.gap_seconds : null;

  return {
    avgSeconds: Math.round(avg * 100) / 100,
    longestSeconds: longest,
    lastSeconds,
    slaBreachCount,
    measuredCount: realPairs.length,
  };
}

// Walks parsed lines and emits the pair list. State machine matches the
// rules from the original prompt — but executed in code, so it always works.
export function computeChatResponseMetricsFromTranscript(
  transcriptText: string,
  campaign?: string | null,
): ChatResponseMetrics {
  const parsed = parseChatTranscript(transcriptText);
  if (parsed.length === 0) return { pairs: [] };

  const rac = isRacCampaign(campaign);
  // Non-RAC chats have no bot pre-stage, so they're "past handover" from the
  // first line. RAC chats only count human replies after the handover marker.
  let pastHandover = !rac;

  const pairs: ChatResponsePair[] = [];
  let pendingCustomerAt: string | null = null;
  let pendingCustomerSeconds: number | null = null;

  for (const line of parsed) {
    if (line.source === 'consumer') {
      // Track only the LATEST unanswered customer message — multiple consecutive
      // customer messages collapse to one pending timestamp (their most recent).
      pendingCustomerAt = line.timestamp;
      pendingCustomerSeconds = line.totalSeconds;
      continue;
    }

    // line.source === 'agent'
    const isPreHandoverBot = rac && !pastHandover;
    const isAuto = !isPreHandoverBot && isAutoMessageContent(line.content);

    if (isPreHandoverBot || isAuto) {
      pairs.push({
        customer_at: null,
        agent_at: line.timestamp,
        gap_seconds: null,
        agent_message_preview: previewOf(line.content),
        is_auto_message: true,
        is_last_pair: false,
      });
      // Detect the handover marker on the same line it appears, so the very
      // next agent line is treated as the first human reply.
      if (isPreHandoverBot && HANDOVER_MARKER_REGEX.test(line.content)) {
        pastHandover = true;
      }
      continue;
    }

    // Real human agent message.
    if (pendingCustomerAt !== null && pendingCustomerSeconds !== null) {
      let gap = line.totalSeconds - pendingCustomerSeconds;
      if (gap < 0) gap += 86400; // single-day midnight rollover
      pairs.push({
        customer_at: pendingCustomerAt,
        agent_at: line.timestamp,
        gap_seconds: gap,
        agent_message_preview: previewOf(line.content),
        is_auto_message: false,
        is_last_pair: false,
      });
      pendingCustomerAt = null;
      pendingCustomerSeconds = null;
    }
    // Else: an agent follow-up with no fresh customer prompt — skip, do not
    // emit a pair (matches rule #3 from the original prompt).
  }

  // Trailing unanswered customer message → emit an explicit "no reply" pair.
  if (pendingCustomerAt !== null) {
    pairs.push({
      customer_at: pendingCustomerAt,
      agent_at: null,
      gap_seconds: null,
      agent_message_preview: '',
      is_auto_message: false,
      is_last_pair: true,
    });
  } else {
    // Otherwise flip is_last_pair on the FINAL non-auto pair.
    for (let i = pairs.length - 1; i >= 0; i--) {
      if (!pairs[i]!.is_auto_message) {
        pairs[i]!.is_last_pair = true;
        break;
      }
    }
  }

  return { pairs };
}
