-- ============================================================================
-- NMGB Survey: manually populate app.interaction_insights from survey answers
-- Run against: ai_insight
--
-- Context:
--   The NMGB Survey campaign is a *survey*, not a sales/service call, so there
--   is nothing for the LLM to infer — the answers are already structured in
--   [icx-rep].[bi].[LeadDataSurvey_NMGB]. This script skips transcription +
--   insight generation entirely and writes the survey answers straight into
--   interaction_insights.campaign_answers_json, so the existing interaction
--   drawer / dashboard plumbing (the Parity path) can render them.
--
-- Join key:  interactions.recordingUrl = survey.[Call Recording]
--   One interactions row exists per call *attempt*; the survey is tied to the
--   specific recording it was captured on. Matching on the recording URL
--   attaches the answers to exactly that one attempt.
--
-- Idempotent: re-runnable. Skips interactions that already have an insight row.
-- ============================================================================

USE [ai_insight];
GO

-- ─── 0. Diagnostics — run this block first, on its own ──────────────────────
-- Confirms the recording-URL join actually matches before you insert anything.
/*
SELECT
  (SELECT COUNT(*) FROM app.interactions
     WHERE campaign = 'NMGB Survey')                                AS nmgb_interactions,
  (SELECT COUNT(*) FROM [icx-rep].[bi].[LeadDataSurvey_NMGB]
     WHERE ISNULL([Call Recording],'') <> '')                       AS survey_rows_with_recording,
  (SELECT COUNT(*)
     FROM app.interactions i
     JOIN [icx-rep].[bi].[LeadDataSurvey_NMGB] s
       ON LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl))
    WHERE i.campaign = 'NMGB Survey')                               AS matched_on_recording;

-- Surveys that WON'T match any interaction (attempt was filtered out of the
-- interactions build, e.g. an excluded result_code). Review before committing.
SELECT s.[IDAction], s.[IDOpportunity], s.[Call Recording]
FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
WHERE ISNULL(s.[Call Recording],'') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM app.interactions i
    WHERE i.campaign = 'NMGB Survey'
      AND LTRIM(RTRIM(i.recordingUrl)) = LTRIM(RTRIM(s.[Call Recording]))
  );
*/

-- ─── 1. Insert one insight row per matched NMGB interaction ─────────────────
-- campaign_answers_json is built with FOR JSON PATH; dotted column aliases
-- (e.g. 'purchase_status.has_not_purchased_yet') create the nested objects.
--
-- NOTE ON FLAG COLUMNS: the P4 Q1 / Q4 / Q6 option columns are passed through
-- as-is, so JSON reflects the source type. If they are BIT you get true/false;
-- if they are int/nvarchar you get 1/0 or "Yes"/"No". Check with:
--   SELECT c.name, t.name AS type FROM sys.columns c
--   JOIN sys.types t ON c.user_type_id = t.user_type_id
--   WHERE c.object_id = OBJECT_ID('[icx-rep].[bi].[LeadDataSurvey_NMGB]');
-- Wrap in CAST(... AS BIT) below if you want strict booleans and the source
-- is 0/1. Leave as-is if you want to preserve the source representation.

INSERT INTO app.interaction_insights
  (id, recordingId, providerUsed, model, json, extractorVersion, createdAt,
   conversation_type, campaign_detected, campaign_answers_json)
SELECT
  NEWID(),
  i.id,
  'manual',                                   -- providerUsed: not an LLM run
  NULL,                                        -- model
  N'{"source":"nmgb_survey_manual"}',          -- json (NOT NULL) — marker blob
  'survey-manual-v1',                          -- extractorVersion
  SYSUTCDATETIME(),
  'survey',                                    -- conversation_type
  'NMGB Survey',                               -- campaign_detected
  (
    SELECT
      'NMGB'                                                 AS [survey],
      s.[IDOpportunity]                                      AS [meta.id_opportunity],
      s.[Survey Data Status]                                 AS [meta.data_status],
      s.[Survey Flow Status]                                 AS [meta.flow_status],

      s.[P2 Q1 Has Not Purchased Yet]                        AS [purchase_status.has_not_purchased_yet],
      s.[P2 Q2 Still Considering]                            AS [purchase_status.still_considering],

      s.[P3 Q1 Interest Follow Up]                           AS [follow_up_interest],

      s.[P4 Q1 Initial Interest Styling Design]              AS [initial_interest.styling_design],
      s.[P4 Q1 Initial Interest Brand Reputation]            AS [initial_interest.brand_reputation],
      s.[P4 Q1 Initial Interest Brand Loyalty]               AS [initial_interest.brand_loyalty],
      s.[P4 Q1 Initial Interest Recommendation]              AS [initial_interest.recommendation],
      s.[P4 Q1 Initial Interest Features]                    AS [initial_interest.features],
      s.[P4 Q1 Initial Interest Size Practicality]           AS [initial_interest.size_practicality],
      s.[P4 Q1 Initial Interest Performance]                 AS [initial_interest.performance],
      s.[P4 Q1 Initial Interest Price Value]                 AS [initial_interest.price_value],
      s.[P4 Q1 Initial Interest Other]                       AS [initial_interest.other],
      s.[P4 Q1 Initial Interest Other Feedback]              AS [initial_interest.other_feedback],

      s.[P4 Q2 Did you visit]                                AS [dealer_visit.visited],
      s.[P4 Q2a Impression of Vehicle]                       AS [dealer_visit.vehicle_impression],
      s.[P4 Q2b Why No Test Drive]                           AS [dealer_visit.why_no_test_drive],

      s.[P4 Q3 Dealership Rating]                            AS [dealership_rating.score],
      s.[P4 Q3a Dealership Rating Feedback]                  AS [dealership_rating.feedback],

      s.[P4 Q4 Not Purchase Reason Price]                    AS [not_purchased_reasons.price],
      s.[P4 Q4 Not Purchase Reason Price Sub Reason]         AS [not_purchased_reasons.price_sub_reason],
      s.[P4 Q4 Not Purchase Reason Expectations]             AS [not_purchased_reasons.expectations],
      s.[P4 Q4 Not Purchase Reason Expectations Sub Reason]  AS [not_purchased_reasons.expectations_sub_reason],
      s.[P4 Q4 Not Purchase Reason Purchase Different Brand] AS [not_purchased_reasons.different_brand],
      s.[P4 Q4 Not Purchase Reason Purchase Different Client Model] AS [not_purchased_reasons.different_client_model],
      s.[P4 Q4 Not Purchase Reason Financing]                AS [not_purchased_reasons.financing],
      s.[P4 Q4 Not Purchase Reason Financing Sub Reason]     AS [not_purchased_reasons.financing_sub_reason],
      s.[P4 Q4 Not Purchase Reason Dealership Experience]    AS [not_purchased_reasons.dealership_experience],
      s.[P4 Q4 Not Purchase Reason Dealership Experience Sub Reason] AS [not_purchased_reasons.dealership_experience_sub_reason],
      s.[P4 Q4 Not Purchase Reason No Interest in EVs]       AS [not_purchased_reasons.no_interest_in_evs],
      s.[P4 Q4 Not Purchase Reason Purchased MOI on Record]  AS [not_purchased_reasons.purchased_moi_on_record],
      s.[P4 Q4 Not Purchase Reason Other]                    AS [not_purchased_reasons.other],
      s.[P4 Q4 Not Purchase Reason Other Feedback]           AS [not_purchased_reasons.other_feedback],

      s.[P4 Q5 Purchase Another Vehicle]                     AS [competitor_purchase.purchased_another_vehicle],
      s.[P4 Q5 Purchase Make]                                AS [competitor_purchase.make],
      s.[P4 Q5 Purchase Model]                               AS [competitor_purchase.model],
      s.[P4 Q5 Purchase Other Model Not Listed]              AS [competitor_purchase.other_model_not_listed],
      s.[P4 Q5 Purchase New Used]                            AS [competitor_purchase.new_used],

      s.[P4 Q6 Influenced APR Lower]                         AS [influenced_by.apr_lower],
      s.[P4 Q6 Influenced Better Value]                      AS [influenced_by.better_value],
      s.[P4 Q6 Influenced Brand Loyalty]                     AS [influenced_by.brand_loyalty],
      s.[P4 Q6 Influenced Colour Spec Pref]                  AS [influenced_by.colour_spec_pref],
      s.[P4 Q6 Influenced Comfortable Interior]              AS [influenced_by.comfortable_interior],
      s.[P4 Q6 Influenced Customer Service]                  AS [influenced_by.customer_service],
      s.[P4 Q6 Influenced Discount]                          AS [influenced_by.discount],
      s.[P4 Q6 Influenced Drive Of Vehicle]                  AS [influenced_by.drive_of_vehicle],
      s.[P4 Q6 Influenced Enhanced Features]                 AS [influenced_by.enhanced_features],
      s.[P4 Q6 Influenced Longer Warranty]                   AS [influenced_by.longer_warranty],
      s.[P4 Q6 Influenced Monthly Payments Lower]            AS [influenced_by.monthly_payments_lower],
      s.[P4 Q6 Influenced Powertrain Options]                AS [influenced_by.powertrain_options],
      s.[P4 Q6 Influenced Pref Design]                       AS [influenced_by.pref_design],
      s.[P4 Q6 Influenced Quicker Delivery]                  AS [influenced_by.quicker_delivery],
      s.[P4 Q6 Influenced Size]                              AS [influenced_by.size],
      s.[P4 Q6 Influenced Try Different]                     AS [influenced_by.try_different],
      s.[P4 Q6 Influenced Purchased MOI on Record]           AS [influenced_by.purchased_moi_on_record],
      s.[P4 Q6 Influenced Other]                             AS [influenced_by.other],
      s.[P4 Q6 Influenced Other Feedback]                    AS [influenced_by.other_feedback],

      s.[P4 Q7 Purchase Reason For]                          AS [purchase_reason],

      s.[P4 Q8 Improve Anything Different]                   AS [improvements.anything_different],
      s.[P4 Q9 Improve Follow Up]                            AS [improvements.follow_up],

      s.[Agent Notes]                                        AS [agent_notes],

      s.[Complaint Type]                                     AS [complaint.type],
      s.[Complaint Type Category]                            AS [complaint.category]
    FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
    WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl))
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  ) AS campaign_answers_json
FROM app.interactions i
WHERE i.campaign = 'NMGB Survey'
  AND EXISTS (
    SELECT 1 FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
    WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl))
  )
  AND NOT EXISTS (
    SELECT 1 FROM app.interaction_insights ii WHERE ii.recordingId = i.id
  );
GO

-- ─── 2. Mark the interactions terminal so no worker transcribes / re-insights ─
-- 'insights_done' keeps them out of both the transcription and insight queues.
-- (Recordings still play in the drawer — playback doesn't need a transcript.)
UPDATE i
SET status = 'insights_done',
    updatedAt = SYSUTCDATETIME()
FROM app.interactions i
WHERE i.campaign = 'NMGB Survey'
  AND EXISTS (SELECT 1 FROM app.interaction_insights ii WHERE ii.recordingId = i.id);
GO
