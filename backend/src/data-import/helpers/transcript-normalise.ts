// Turns a provider's flat transcript column into the JSON message array the app
// already understands, so imported chats render as bubbles and feed the chat
// response-time metrics without any new pipeline code.
//
// Target shape (satisfies BOTH consumers):
//   insights/chat-response-time.ts parseChatTranscript -> needs `source`
//   InteractionDetailDrawer.vue     chatMessages       -> needs `id` + `sender`
//
//   [{ id: 0, source: "Agent", sender: "Jane", timestamp: "2026-06-01T14:03:07", content: "..." }]
//
// JSON is preferred over the plain-text "HH:MM-agent: ..." form because the text
// form does its arithmetic in seconds-from-midnight and so computes negative
// response times for any conversation that crosses midnight.

import {
  AUTO_MESSAGE_PATTERNS,
  HANDOVER_MARKER_REGEX,
} from '../../insights/chat-response-time';
import { toNaiveIso } from './parse-date';
import { TranscriptMapping } from '../mappings/mapping.types';

/** Classification of a transcript line's speaker. */
export type MessageSource = 'Agent' | 'Customer' | 'System' | 'Bot' | 'Unknown';

export interface StagedMessage {
  seq: number;
  source: MessageSource;
  /** Speaker label verbatim from the transcript. */
  sender: string;
  /** Timestamp text as printed, e.g. "14:03:07". */
  timestampText: string | null;
  /** Reconstructed naive-local ISO, or null when no anchor date was available. */
  timestampIso: string | null;
  /** Days past the anchor date, from the midnight-rollover walk. */
  dayOffset: number;
  content: string;
  isAuto: boolean;
  isHandover: boolean;
  /**
   * Whether this message is included in the promoted transcript JSON. Unknown
   * speakers are staged (so they are visible in the UI) but excluded, since
   * mis-attributing them would corrupt the response-time metrics.
   */
  includedInTranscript: boolean;
  parseWarning: string | null;
}

export type TranscriptParseStatus = 'parsed' | 'partial' | 'unparsed' | 'empty';

export interface NormalisedTranscript {
  messages: StagedMessage[];
  /** JSON for interaction_transcripts.text, or null when nothing was usable. */
  transcriptJson: string | null;
  /** Count of messages actually included in transcriptJson. */
  includedCount: number;
  status: TranscriptParseStatus;
  unknownSpeakerCount: number;
  /** Non-empty lines that matched no message and no continuation. */
  unparsedLineCount: number;
  maxDayOffset: number;
}

// Speaker label is bounded at 60 chars so a colon inside prose ("Note: ...")
// cannot be mistaken for a speaker delimiter on a continuation line.
const LINE_RE =
  /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*([^:]{1,60}?)\s*:\s*(.*)$/;

// Backstop for a runaway rollover walk: a real chat never spans a week.
const MAX_DAY_OFFSET = 7;

// Tolerance for a backwards timestamp before it counts as crossing midnight.
// Absorbs out-of-order lines within the same minute (common when several
// messages share a timestamp) without inventing a day jump.
const ROLLOVER_TOLERANCE_SECONDS = 60;

function timeToSeconds(ts: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(ts);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

function isAutoContent(content: string): boolean {
  // Match against the head only, mirroring isAutoMessageContent in
  // chat-response-time.ts: a long substantive reply that merely echoes a
  // templated phrase later should not be filtered.
  const head = content.slice(0, 400);
  return AUTO_MESSAGE_PATTERNS.some((p) => p.test(head));
}

/**
 * Classifies a speaker label. Anything unrecognised becomes 'Unknown' — never
 * guessed. A label matching the row's agent name is an Agent, which is what
 * makes exports that print real names instead of roles usable.
 */
export function classifySpeaker(
  label: string,
  mapping: TranscriptMapping,
  agentNames: string[],
): MessageSource {
  const lower = label.trim().toLowerCase();
  if (!lower) return 'Unknown';

  if (mapping.botLabels.some((l) => lower === l.toLowerCase())) return 'Bot';
  if (mapping.systemLabels.some((l) => lower === l.toLowerCase())) return 'System';
  if (mapping.agentLabels.some((l) => lower === l.toLowerCase())) return 'Agent';
  if (mapping.customerLabels.some((l) => lower === l.toLowerCase())) {
    return 'Customer';
  }

  // Real agent names, e.g. "14:03 - Jane Smith: hello".
  if (agentNames.some((n) => n && n.trim().toLowerCase() === lower)) {
    return 'Agent';
  }

  return 'Unknown';
}

/**
 * The `source` value written into transcriptJson. parseChatTranscript maps
 * 'agent' -> agent and consumer|customer|user|visitor -> consumer, and drops
 * everything else, so Bot and System must be labelled as Agent-side to be
 * counted at all — which is correct: they are platform-side messages, and the
 * handover marker is what separates bot from human downstream.
 */
function transcriptSourceLabel(source: MessageSource): string | null {
  switch (source) {
    case 'Agent':
    case 'Bot':
    case 'System':
      return 'Agent';
    case 'Customer':
      return 'Customer';
    default:
      return null;
  }
}

interface ParseLinesResult {
  messages: StagedMessage[];
  unparsedLineCount: number;
}

/** Splits transcript text into messages, folding continuation lines. */
function parseLines(
  text: string,
  mapping: TranscriptMapping,
  agentNames: string[],
  forcedSource?: MessageSource,
): ParseLinesResult {
  const messages: StagedMessage[] = [];
  let unparsedLineCount = 0;
  let current: StagedMessage | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(rawLine);
    if (m) {
      const [, ts, label, rest] = m;
      if (timeToSeconds(ts!) === null) {
        // Looked like a message but the clock is nonsense (e.g. 99:99).
        if (current) {
          current.content += '\n' + rawLine;
        } else if (rawLine.trim()) {
          unparsedLineCount++;
        }
        continue;
      }
      if (current) messages.push(current);
      const source = forcedSource ?? classifySpeaker(label!, mapping, agentNames);
      current = {
        seq: messages.length,
        source,
        sender: label!.trim(),
        timestampText: ts!,
        timestampIso: null,
        dayOffset: 0,
        content: rest ?? '',
        isAuto: false,
        isHandover: false,
        includedInTranscript: source !== 'Unknown',
        parseWarning:
          source === 'Unknown'
            ? `Unrecognised speaker label "${label!.trim()}"`
            : null,
      };
    } else if (current) {
      // Continuation. Preserved with the newline so multi-line messages keep
      // their shape in the chat bubble.
      current.content += '\n' + rawLine;
    } else if (rawLine.trim()) {
      unparsedLineCount++;
    }
  }
  if (current) messages.push(current);

  return { messages, unparsedLineCount };
}

/**
 * Walks messages in order, incrementing a day offset whenever the clock jumps
 * backwards, and stamps each with a naive-local ISO timestamp anchored on the
 * conversation's start date.
 */
function stampTimestamps(messages: StagedMessage[], anchor: Date | null): number {
  let prevSeconds: number | null = null;
  let dayOffset = 0;
  let maxDayOffset = 0;

  for (const msg of messages) {
    const secs = msg.timestampText ? timeToSeconds(msg.timestampText) : null;
    if (secs === null) {
      msg.dayOffset = dayOffset;
      continue;
    }

    if (
      prevSeconds !== null &&
      secs < prevSeconds - ROLLOVER_TOLERANCE_SECONDS &&
      dayOffset < MAX_DAY_OFFSET
    ) {
      dayOffset++;
    }
    prevSeconds = secs;
    msg.dayOffset = dayOffset;
    if (dayOffset > maxDayOffset) maxDayOffset = dayOffset;

    if (anchor) {
      const d = new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + dayOffset,
        Math.floor(secs / 3600),
        Math.floor((secs % 3600) / 60),
        secs % 60,
      );
      msg.timestampIso = toNaiveIso(d);
    }
  }

  return maxDayOffset;
}

/** Marks auto-messages and the bot/human handover boundary. */
function markFlags(messages: StagedMessage[]): void {
  for (const msg of messages) {
    msg.isAuto = isAutoContent(msg.content);
    msg.isHandover = HANDOVER_MARKER_REGEX.test(msg.content);
  }
}

function mergeSideTranscripts(
  agentText: string,
  consumerText: string,
  mapping: TranscriptMapping,
  agentNames: string[],
): StagedMessage[] {
  const agent = parseLines(agentText, mapping, agentNames, 'Agent').messages;
  const consumer = parseLines(consumerText, mapping, agentNames, 'Customer')
    .messages;

  const combined = [...agent, ...consumer];
  // Stable sort by clock; messages without a usable clock keep their relative
  // order at the end rather than being dropped.
  combined.sort((a, b) => {
    const as = a.timestampText ? timeToSeconds(a.timestampText) : null;
    const bs = b.timestampText ? timeToSeconds(b.timestampText) : null;
    if (as === null && bs === null) return 0;
    if (as === null) return 1;
    if (bs === null) return -1;
    return as - bs;
  });
  combined.forEach((m, i) => {
    m.seq = i;
  });
  return combined;
}

export interface NormaliseOptions {
  /** transcriptAll (or the mapping's primary transcript column). */
  raw: string | null | undefined;
  /** Per-side fallbacks, used when `raw` is empty. */
  agentSide?: string | null;
  consumerSide?: string | null;
  /** Conversation start, used to anchor reconstructed timestamps. */
  anchorDate: Date | null;
  /** Candidate real agent names for speaker classification. */
  agentNames?: string[];
  mapping: TranscriptMapping;
}

export function normaliseTranscript(
  opts: NormaliseOptions,
): NormalisedTranscript {
  const { raw, agentSide, consumerSide, anchorDate, mapping } = opts;
  const agentNames = (opts.agentNames ?? []).filter(Boolean);

  const empty: NormalisedTranscript = {
    messages: [],
    transcriptJson: null,
    includedCount: 0,
    status: 'empty',
    unknownSpeakerCount: 0,
    unparsedLineCount: 0,
    maxDayOffset: 0,
  };

  const primary = (raw ?? '').trim();
  let messages: StagedMessage[];
  let unparsedLineCount = 0;

  if (primary) {
    const parsed = parseLines(raw!, mapping, agentNames);
    messages = parsed.messages;
    unparsedLineCount = parsed.unparsedLineCount;
  } else if ((agentSide ?? '').trim() || (consumerSide ?? '').trim()) {
    // Fallback export variant: no combined column, but both sides present. The
    // speaker is known from the column, so classification cannot fail here.
    messages = mergeSideTranscripts(
      agentSide ?? '',
      consumerSide ?? '',
      mapping,
      agentNames,
    );
  } else {
    return empty;
  }

  if (messages.length === 0) {
    return {
      ...empty,
      status: 'unparsed',
      unparsedLineCount:
        unparsedLineCount || primary.split(/\r?\n/).filter((l) => l.trim()).length,
    };
  }

  markFlags(messages);
  const maxDayOffset = stampTimestamps(messages, anchorDate);

  const unknownSpeakerCount = messages.filter((m) => m.source === 'Unknown').length;
  const included = messages.filter((m) => m.includedInTranscript);

  const payload = included
    .map((m, i) => ({
      id: i,
      source: transcriptSourceLabel(m.source)!,
      sender: m.sender,
      timestamp: m.timestampIso ?? m.timestampText ?? '',
      content: m.content,
    }))
    // A message with no usable timestamp at all cannot be ordered or measured,
    // so it is left out of the promoted transcript.
    .filter((m) => m.timestamp !== '');

  const status: TranscriptParseStatus =
    payload.length === 0
      ? 'unparsed'
      : unknownSpeakerCount > 0 || unparsedLineCount > 0
        ? 'partial'
        : 'parsed';

  return {
    messages,
    transcriptJson: payload.length ? JSON.stringify(payload) : null,
    includedCount: payload.length,
    status,
    unknownSpeakerCount,
    unparsedLineCount,
    maxDayOffset,
  };
}
