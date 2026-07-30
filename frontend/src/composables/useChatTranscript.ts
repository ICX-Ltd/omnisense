// Parsing for stored interaction transcripts.
//
// Single source of truth, shared by InteractionDetailDrawer and CsatDashboard.
// It previously lived only inside the drawer, so the CSAT page fell back to a raw
// <pre> dump — which was tolerable for the old plain-text format but renders a
// wall of JSON now that imported chats are stored as a message array.
//
// Three stored shapes are supported:
//   1. JSON array  — [{ id, source, sender, timestamp, content }]  (imported chats)
//   2. Line format — "HH:MM[:SS] - Speaker: text"                  (older chats)
//   3. Diarized    — "Speaker N: text"                             (Deepgram calls)

export interface ChatMessage {
  id: number;
  /** 'Agent' renders left; anything else renders right as the customer. */
  source: string;
  sender: string;
  timestamp: string;
  content: string;
}

export interface CallTurn {
  speaker: number;
  label: string;
  text: string;
}

/** Parses the "HH:MM[:SS] - Speaker: text" line format, folding continuations. */
function parseLineChatFormat(text: string): ChatMessage[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const re = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*([^:]+):\s*(.*)$/i;
  const msgs: ChatMessage[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const role = m[2]!.trim().toLowerCase();
      const source = role === "agent" ? "Agent" : "Customer";
      const sender = role === "agent" ? "Agent" : m[2]!.trim();
      msgs.push({
        id: msgs.length,
        source,
        sender,
        timestamp: m[1]!,
        content: m[3] ?? "",
      });
    } else if (msgs.length) {
      msgs[msgs.length - 1]!.content += " " + line;
    } else {
      // Not this format at all — let the caller fall back to raw text.
      return [];
    }
  }
  return msgs;
}

/** Normalises a parsed JSON array into ChatMessage[], or null if unusable. */
function fromJsonArray(parsed: unknown): ChatMessage[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return (parsed as ChatMessage[])
    .map((m, i) => ({
      id: typeof m?.id === "number" ? m.id : i,
      source: m?.source ?? "Customer",
      sender: m?.sender ?? m?.source ?? "",
      timestamp: m?.timestamp ?? "",
      content: typeof m?.content === "string" ? m.content : String(m?.content ?? ""),
    }))
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
}

/**
 * Parses a chat transcript into messages, or returns [] when the text is not a
 * recognised chat shape (the caller then shows the raw text).
 */
export function parseChatMessages(text: string | null | undefined): ChatMessage[] {
  if (!text) return [];
  let raw = text;

  // JSON array first: well-formed JSON also fails the line regex, so trying the
  // line parser first would silently yield nothing for imported chats.
  try {
    let parsed: unknown = JSON.parse(raw);

    // Some transcripts are double-encoded — a JSON string wrapping the real
    // payload. Unwrap once, then retry BOTH shapes: the inner value may be a
    // JSON array, not just line-format text. The backend already unwraps this
    // way (parseChatTranscript in insights/chat-response-time.ts), so handling
    // only the text case here left the UI showing raw JSON for a transcript the
    // metrics code was reading perfectly well.
    if (typeof parsed === "string") {
      raw = parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null; // inner value is plain text — line parser handles it
      }
    }

    const fromArray = fromJsonArray(parsed);
    if (fromArray) return fromArray;
  } catch {
    /* not JSON — fall through to the line format */
  }

  return parseLineChatFormat(raw);
}

/**
 * Parses a diarized call transcript stored one turn per line as
 * "Speaker N: text". Returns [] for prose transcripts with no speaker labels.
 */
export function parseCallTurns(text: string | null | undefined): CallTurn[] {
  const raw = text ?? "";
  if (!raw.trim()) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const re = /^Speaker\s+(\d+)\s*:\s*(.*)$/i;
  const turns: CallTurn[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const speaker = Number(m[1]);
      turns.push({ speaker, label: `Speaker ${speaker + 1}`, text: m[2] ?? "" });
    } else if (turns.length) {
      turns[turns.length - 1]!.text += " " + line;
    } else {
      return [];
    }
  }
  return turns;
}

/**
 * Renders a message timestamp as a short local wall-clock time.
 *
 * Imported transcripts store a naive-local ISO string (no Z) precisely so this
 * shows the time the agent saw rather than one shifted into the viewer's zone.
 */
export function fmtTranscriptTime(ts: string): string {
  if (!ts) return "";
  if (/^\d{2}:\d{2}:\d{2}$/.test(ts)) return ts.slice(0, 5);
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
