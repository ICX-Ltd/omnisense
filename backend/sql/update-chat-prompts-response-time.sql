-- =============================================================================
-- Chat prompts: agent response-time metrics
-- Run against the ai_assist database (app.prompt_templates).
--
-- Performs two things idempotently:
--   1) Patches chat.base to replace the deprecated "cannot be measured" note
--      with {{response_time_section}}, and injects {{response_time_schema}}
--      into the JSON SCHEMA block. A history row is written before the update.
--   2) Inserts chat.response_time and chat.response_time_schema if missing.
--
-- Re-runs are safe — guarded by body-content checks and IF NOT EXISTS.
-- =============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

-- ─── 1) chat.base — patch placeholders ───────────────────────────────────────

DECLARE @needsBaseUpdate BIT = 0;
SELECT @needsBaseUpdate = 1
FROM app.prompt_templates
WHERE [key] = 'chat.base'
  AND body LIKE N'%cannot be measured from transcript text alone%';

IF @needsBaseUpdate = 1
BEGIN
  -- Snapshot current body into history before mutating.
  INSERT INTO app.prompt_template_history
    (promptTemplateId, [key], version, body, label, notes, updatedById)
  SELECT id, [key], version, body, label, notes, updatedById
  FROM app.prompt_templates
  WHERE [key] = 'chat.base';

  -- Replace the "Response time SLAs cannot be measured" sentence with the
  -- new {{response_time_section}} placeholder.
  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              N'Note: Response time and accept time SLAs cannot be measured from transcript text alone — leave those fields null.',
              N'{{response_time_section}}'
            )
  WHERE [key] = 'chat.base';

  -- Inject the schema placeholder after the operations/qa/objection schema line.
  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              N'{{operations_schema}}{{qa_schema}}{{objection_schema}},',
              N'{{operations_schema}}{{qa_schema}}{{objection_schema}},'
                + CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10)
                + N'  {{response_time_schema}},'
            ),
      version     = version + 1,
      updatedAt   = SYSUTCDATETIME()
  WHERE [key] = 'chat.base';

  PRINT 'chat.base patched — version bumped, history row written.';
END
ELSE IF EXISTS (SELECT 1 FROM app.prompt_templates WHERE [key] = 'chat.base')
BEGIN
  PRINT 'chat.base already migrated — skipping.';
END
ELSE
BEGIN
  PRINT 'chat.base not found — boot the backend to seed it, then re-run this script.';
END;

-- ─── 2a) chat.response_time (new) ────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM app.prompt_templates WHERE [key] = 'chat.response_time')
BEGIN
  INSERT INTO app.prompt_templates
    ([key], interactionType, kind, campaign, label, notes, body, version, isActive)
  VALUES (
    'chat.response_time',
    'chat',
    'other',
    NULL,
    N'Chat — agent response-time metrics (per-turn pair list)',
    N'Tells the model how to measure customer→agent response gaps from per-message timestamps, exclude auto-messages, and return the raw pairs array. Backend aggregates avg/longest/last/SLA breach counts.',
    N'
═══════════════════════════════════════
SECTION — AGENT RESPONSE-TIME METRICS
═══════════════════════════════════════

Transcripts include per-message timestamps for every customer and agent line
(typically HH:MM or HH:MM:SS). Use those timestamps to measure how quickly the
human agent responds to each customer message.

── DEFINITIONS ──

Customer message       → any line attributed to the customer (the visitor / member).
Agent message          → a line written by the HUMAN colleague that materially
                          replies to, acknowledges, or progresses the customer''s
                          message. This is the message used to measure response time.
Auto-message (EXCLUDE) → a system-generated nudge that fires automatically when
                          the customer goes quiet. These must NOT be counted as
                          an agent response.

Typical auto-message patterns (non-exhaustive — use judgement):
  • "We haven''t heard from you in a while. Is there anything else we can help with?"
  • "Are you still there?" / "Are you still with me?"
  • "This chat will close shortly due to inactivity."
  • "Closing the chat now as we haven''t heard back."
  • Identical / near-identical chase prompts repeated verbatim with no fresh content.

When in doubt — if a message contains no specific information, no question
tailored to the customer, and reads like a generic timeout chase — flag it
as is_auto_message: true and exclude it from the response-time pairing.

For RAC chats: any "Agent:" line BEFORE the "You are now connected to" handover
marker is a BOT message, not the human colleague. Treat those as
is_auto_message: true as well — they do not count toward agent response time.

── HOW TO BUILD THE PAIR LIST ──

Walk the transcript in order. For every customer message, find the next
HUMAN agent reply (skipping any agent line you tagged is_auto_message: true).
Record one pair:

  {
    "customer_at": string,          // verbatim timestamp from the transcript
    "agent_at": string | null,      // verbatim timestamp of the responding human reply, or null if no human reply ever followed
    "gap_seconds": number | null,   // difference in seconds, or null if agent_at is null
    "agent_message_preview": string,// first ~80 chars of the agent reply (or "" if none)
    "is_auto_message": false,       // false for matched human replies; see below for auto-only segments
    "is_last_pair": boolean         // true ONLY for the final customer→agent pair in the chat
  }

If the customer''s last message was never answered by a human (chat ended /
went idle), still emit a pair with agent_at = null, gap_seconds = null, and
is_last_pair = true.

If an agent message is auto-generated, emit a separate diagnostic entry so we
can audit which lines were excluded:

  {
    "customer_at": null,
    "agent_at": string,
    "gap_seconds": null,
    "agent_message_preview": string,
    "is_auto_message": true,
    "is_last_pair": false
  }

── TIMESTAMP ARITHMETIC ──

Compute gap_seconds = (agent_at − customer_at) expressed in whole seconds.
Handle midnight rollover by assuming the chat does not span more than one
calendar day; if a later timestamp appears earlier on the clock (e.g.
00:02 after 23:58), add 24 hours.

If only HH:MM is available, treat both timestamps as :00 seconds — the gap
will be a whole-minute multiple of 60.

If a timestamp is unparseable, set gap_seconds = null for that pair.

── DO NOT COMPUTE THE AGGREGATES ──

The backend will compute the average, longest, last-response and SLA-breach
counts from the pair list you return. Just emit the pairs accurately —
include every customer message and every auto-message exclusion so the
aggregation is auditable.

If the transcript has no customer messages at all, or no timestamps are
present, return an empty pairs array.
',
    1,
    1
  );
  PRINT 'chat.response_time inserted.';
END
ELSE
BEGIN
  PRINT 'chat.response_time already exists — skipping.';
END;

-- ─── 2b) chat.response_time_schema (new) ─────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM app.prompt_templates WHERE [key] = 'chat.response_time_schema')
BEGIN
  INSERT INTO app.prompt_templates
    ([key], interactionType, kind, campaign, label, notes, body, version, isActive)
  VALUES (
    'chat.response_time_schema',
    'chat',
    'other',
    NULL,
    N'Chat — response-time JSON schema',
    N'Schema for the chat_response_metrics object containing the pairs array.',
    N'"chat_response_metrics": {
    "pairs": [
      {
        "customer_at": string | null,
        "agent_at": string | null,
        "gap_seconds": number | null,
        "agent_message_preview": string,
        "is_auto_message": boolean,
        "is_last_pair": boolean
      }
    ]
  }',
    1,
    1
  );
  PRINT 'chat.response_time_schema inserted.';
END
ELSE
BEGIN
  PRINT 'chat.response_time_schema already exists — skipping.';
END;

COMMIT TRANSACTION;
GO

-- Quick verification — should show non-null bodies and chat.base referencing
-- both placeholders.
SELECT [key], version, isActive, LEN(body) AS body_len
FROM app.prompt_templates
WHERE [key] IN ('chat.base', 'chat.response_time', 'chat.response_time_schema')
ORDER BY [key];
GO
