-- =============================================================================
-- chat.response_time prompt rewrite (v2)
-- Run against the ai_assist database.
--
-- Fixes the pairing rules so the model:
--   1) Flags every pre-handover RAC bot line as is_auto_message: true,
--      including bot questions and "I'm just connecting you" acknowledgements.
--   2) Anchors on the LATEST unanswered customer message rather than the
--      first one in the chat (so customer-silence gaps no longer get blamed
--      on the agent).
--   3) Recomputes gap_seconds using explicit seconds-from-midnight arithmetic
--      (the backend will still re-derive gaps defensively as a safety check).
--   4) Includes a worked RAC example showing the right vs. wrong reading.
--
-- A history row is written before the body is replaced. Re-runs are no-ops
-- because we guard on a marker only present in the new body.
-- =============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM app.prompt_templates
  WHERE [key] = 'chat.response_time'
    AND body NOT LIKE N'%WORKED EXAMPLE (RAC handover)%'
)
BEGIN
  -- Snapshot the existing body into history.
  INSERT INTO app.prompt_template_history
    (promptTemplateId, [key], version, body, label, notes, updatedById)
  SELECT id, [key], version, body, label, notes, updatedById
  FROM app.prompt_templates
  WHERE [key] = 'chat.response_time';

  UPDATE app.prompt_templates
  SET body = N'
═══════════════════════════════════════
SECTION — AGENT RESPONSE-TIME METRICS
═══════════════════════════════════════

Transcripts include per-message timestamps for every customer and agent line
(typically HH:MM or HH:MM:SS). Use those timestamps to measure how quickly the
HUMAN agent responds to customer messages.

── DEFINITIONS ──

Customer message       → any line attributed to the customer (the visitor / member).
Human agent message    → a line written by the HUMAN colleague that materially
                          replies to the customer. This is the only kind of
                          message that counts as a real "agent response".
Auto-message (EXCLUDE) → a system-generated message that does NOT count as a
                          human response. Includes idle nudges, closure
                          warnings, AND every pre-handover bot line in RAC
                          chats. See the rules below.

Typical idle / closure auto-message patterns (non-exhaustive — use judgement):
  • "We haven''t heard from you in a while. Is there anything else we can help with?"
  • "Are you still there?" / "Are you still with me?"
  • "This chat will close shortly due to inactivity."
  • "Closing the chat now as we haven''t heard back."
  • Identical / near-identical chase prompts repeated verbatim with no fresh content.

CRITICAL RAC RULE — every "Agent:" line BEFORE the "You are now connected to ..."
handover marker is a BOT, not the human colleague. This includes ALL of the
following, no matter how human they read:
  • Welcome / "We''re still learning..." style intros
  • Bot questions like "What''s your full name?" / "What''s your email address?"
  • Bot acknowledgements like "Thanks! I''m just connecting you with an agent"
  • The handover marker line itself ("You are now connected to <name>")
All of those must have is_auto_message: true. The human agent only begins
contributing AFTER the handover marker.

── HOW TO BUILD THE PAIR LIST ──

Walk the transcript chronologically. Track a single state variable
"pending_customer_at" — the timestamp of the most recent customer message
that has NOT yet been answered by a HUMAN agent. Start with it unset.

For each line, in order:

• Customer message:
    Set pending_customer_at = this line''s timestamp.
    If the customer sends multiple messages in a row with no HUMAN agent
    reply between them, pending_customer_at keeps updating to the LATEST
    one. The clock for measuring agent response starts from the customer''s
    most recent unanswered message, not the first.

• Auto-message OR pre-handover bot agent message:
    Emit a DIAGNOSTIC pair so we can audit the exclusion:
      { "customer_at": null,
        "agent_at": <this timestamp>,
        "gap_seconds": null,
        "agent_message_preview": <first ~80 chars>,
        "is_auto_message": true,
        "is_last_pair": false }
    DO NOT change pending_customer_at — the customer is still waiting for
    a human.

• Human agent message (only possible AFTER the RAC handover marker):
    If pending_customer_at is set, emit a measured pair:
      { "customer_at": pending_customer_at,
        "agent_at": <this timestamp>,
        "gap_seconds": <difference in whole seconds>,
        "agent_message_preview": <first ~80 chars>,
        "is_auto_message": false,
        "is_last_pair": false }
    Then clear pending_customer_at.
    If pending_customer_at is NOT set (the human typed a follow-up without
    a fresh customer prompt), skip — do not emit a pair.

• End of transcript with pending_customer_at still set
  (the final customer message went unanswered):
    Emit one unanswered pair:
      { "customer_at": pending_customer_at,
        "agent_at": null,
        "gap_seconds": null,
        "agent_message_preview": "",
        "is_auto_message": false,
        "is_last_pair": true }

After the walk, flip is_last_pair to true on the FINAL non-auto pair (the
last measured or unanswered pair). Every other pair must have
is_last_pair: false. Auto-message diagnostic pairs are always
is_last_pair: false.

── TIMESTAMP ARITHMETIC ──

Compute gap_seconds = (agent_at − customer_at) in whole seconds. Convert
each timestamp to total seconds-from-midnight before subtracting:
  09:02:32  →  9*3600 + 2*60 + 32 = 32552
  09:11:42  →  9*3600 + 11*60 + 42 = 33102
  gap        =  33102 − 32552 = 550 seconds   (9m 10s — not 10m 10s)

Avoid mental arithmetic shortcuts that produce wrong minute counts.

Handle midnight rollover by assuming the chat does not span more than one
calendar day; if a later timestamp appears earlier on the clock (e.g.
00:02 after 23:58), add 24 hours.

If only HH:MM is available, treat both timestamps as :00 seconds — the gap
will be a whole-minute multiple of 60.

If a timestamp is unparseable, set gap_seconds = null for that pair.

── DO NOT COMPUTE THE AGGREGATES ──

The backend computes the average, longest, last-response and SLA-breach
counts from the pair list you return — and will re-derive gap_seconds from
the timestamps as a safety check. Just emit the pairs accurately, including
every auto-message exclusion, so the aggregation is auditable.

If the transcript has no customer messages at all, or no timestamps are
present, return an empty pairs array.

── WORKED EXAMPLE (RAC handover) ──

Transcript:
  09:02:32 consumer: I already have breakdown cover
  09:02:34 agent:    We''re still learning, please use the buttons...   ← bot (pre-handover)
  09:02:54 consumer: Help choosing cover
  09:02:57 agent:    What''s your full name?                            ← bot (pre-handover)
  09:11:15 consumer: I have a flat tyre
  09:11:42 agent:    Thanks! I''m just connecting you with an agent     ← bot (pre-handover)
  09:11:46 agent:    You are now connected to Lyndsey.                 ← handover marker (still bot)
  09:12:05 consumer: Thank you
  09:12:41 agent:    Good morning, you''re through to Lyndsey ...       ← FIRST human agent reply
  09:42:45 agent:    We haven''t heard from you in a while ...          ← idle auto-message

Correct pair list (5 diagnostic + 1 measured = 6 pairs):
  • 4 auto-message diagnostics for the pre-handover bot lines
    (09:02:34, 09:02:57, 09:11:42, 09:11:46)
  • 1 measured pair: customer_at=09:12:05, agent_at=09:12:41,
    gap_seconds=36, is_last_pair=true
  • 1 auto-message diagnostic for the 09:42:45 idle nudge

WRONG interpretations to avoid:
  • Pairing 09:02:32 (the customer''s first message) with 09:11:42 (a bot
    acknowledgement) and calling it a 9-minute agent reply — the bot is
    not the human colleague.
  • Treating any pre-handover agent line as a real response just because
    it phrases itself politely.
  • Anchoring on a stale customer message when the customer has since sent
    newer messages — always use the LATEST unanswered customer timestamp.
',
      version    = version + 1,
      updatedAt  = SYSUTCDATETIME()
  WHERE [key] = 'chat.response_time';

  PRINT 'chat.response_time updated (v2) — version bumped, history row written.';
END
ELSE IF EXISTS (SELECT 1 FROM app.prompt_templates WHERE [key] = 'chat.response_time')
BEGIN
  PRINT 'chat.response_time already at v2 — skipping.';
END
ELSE
BEGIN
  PRINT 'chat.response_time not found — boot the backend to seed it, then re-run this script.';
END;

COMMIT TRANSACTION;
GO

SELECT [key], version, isActive, LEN(body) AS body_len
FROM app.prompt_templates
WHERE [key] = 'chat.response_time';
GO
