-- =============================================================================
-- chat.response_time prompt rewrite (v3)
-- Run against the ai_assist database.
--
-- Adds:
--   • A HARD CONSTRAINTS block forcing chronological pair order, treating
--     every human message (including acks/holds) as a response, and
--     forbidding "second agent message after another agent message" pairs.
--   • A second worked example demonstrating the ack-then-lookup pattern
--     so the model stops skipping early human acks in favour of later
--     substantive messages.
--   • An ADDITIONAL WRONG PATTERN note covering backwards pairs (where
--     the model attaches a customer "Yes" to an earlier agent question).
--
-- A history row is written before the body is replaced. Re-runs are no-ops
-- because we guard on the new HARD CONSTRAINTS marker.
-- =============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

IF EXISTS (
  SELECT 1 FROM app.prompt_templates
  WHERE [key] = 'chat.response_time'
    AND body NOT LIKE N'%HARD CONSTRAINTS (always enforce)%'
)
BEGIN
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

── HARD CONSTRAINTS (always enforce) ──

  1. CHRONOLOGY: agent_at must be a timestamp that appears LATER in the
     transcript than customer_at. NEVER emit a pair where the agent line
     came before the customer line. If you ever find yourself doing that,
     you are pairing the customer''s REPLY to the agent (not the agent''s
     reply to the customer) — drop the attempt and re-walk the transcript.

  2. ALL HUMAN MESSAGES COUNT. Once past the handover marker, every line
     attributed to the agent is a response that resets the clock — no
     matter how brief or how non-substantive. This includes:
       • Acknowledgements: "Got it", "Sure", "One moment"
       • Hold messages: "I''m just going to take a look, won''t be long"
       • Follow-up questions: "Could I take your address please?"
       • Empathy or thanks: "Thanks for confirming"
     Do NOT skip an early ack in favour of a later, more substantive
     message. The first human reply after a customer message is the
     measured response — full stop.

  3. PAIR WITH THE IMMEDIATELY-NEXT HUMAN REPLY only. A second human
     message that follows another human message (with no customer message
     between them) is a follow-up, not a response — do not emit a pair
     for it. Only auto-messages and pre-handover bot lines are skipped
     in the walk.

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

── WORKED EXAMPLE (agent ack, then long lookup) ──

Transcript (post-handover):
  16:20:19 consumer: At home
  16:20:41 agent:    Perfect! I''m just going to take a look at what we''ve got on offer and come back to you in a minute or two with some options. I won''t be long.
  16:24:50 agent:    Thanks for confirming you''d like Home Cover ... [full options listed]

Correct pair list (1 measured pair):
  • customer_at=16:20:19, agent_at=16:20:41, gap_seconds=22,
    is_auto_message=false  (the ack IS the response)
  • The 16:24:50 message is a follow-up — pending_customer_at is empty
    when we reach it, so skip; do not emit a pair.

WRONG: pairing 16:20:19 with 16:24:50 and calling it a 4m 31s response.
The clock stopped at 16:20:41 when the human first replied. The four
minutes that followed was lookup time, not response time.

── ADDITIONAL WRONG PATTERN (backwards pairing) ──

If the agent asks the customer a question and the customer replies "Yes",
do NOT pair the customer''s "Yes" with the agent''s earlier question. That
measures the CUSTOMER''s response time, not the agent''s. Always look for
the agent message that follows the customer message, never the one that
preceded it.
',
      version    = version + 1,
      updatedAt  = SYSUTCDATETIME()
  WHERE [key] = 'chat.response_time';

  PRINT 'chat.response_time updated (v3) — version bumped, history row written.';
END
ELSE IF EXISTS (SELECT 1 FROM app.prompt_templates WHERE [key] = 'chat.response_time')
BEGIN
  PRINT 'chat.response_time already at v3 — skipping.';
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
