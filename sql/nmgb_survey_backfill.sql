-- =============================================================================
-- NMGB Survey — re-derive survey answers onto the insight row (idempotent UPDATE)
-- =============================================================================
-- Companion to sql/nmgb_survey_insights.sql (the initial manual INSERT).
--
-- Purpose:
--   The survey dashboard filters interaction_insights on BOTH
--     ii.campaign_answers_json IS NOT NULL   AND   ii.conversation_type = 'survey'
--   (see backend/src/insights/survey-analytics.service.ts). Running the LLM
--   insights batch upserts the whole insight row keyed on recordingId, which
--   nulls campaign_answers_json and overwrites conversation_type — so the survey
--   rows drop off the dashboard. This UPDATE restores both from the source
--   survey table, keyed on recordingUrl. It is the single source of truth for
--   the survey blob and is safe to run repeatedly, before or after the LLM run.
--
-- Typical sequence when (re)processing these records through the model:
--   1. Reset the rows to 'pending_transcription'
--   2. Batch transcribe   -> real transcript replaces the placeholder
--   3. Batch insights      -> LLM fills summary/scores/etc.; nulls the survey blob
--   4. Run THIS script      -> restores conversation_type='survey' + survey blob
--   (rows end at 'insights_done', so no queue re-picks them — backfill stays put)
-- =============================================================================

UPDATE ii
SET
  conversation_type   = 'survey',
  campaign_detected   = 'NMGB Survey',
  campaign_answers_json = (
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
    WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl)) COLLATE DATABASE_DEFAULT
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  )
FROM app.interaction_insights ii
INNER JOIN app.interactions i ON i.id = ii.recordingId
WHERE i.campaign = 'NMGB Survey'
  AND EXISTS (
    SELECT 1 FROM [icx-rep].[bi].[LeadDataSurvey_NMGB] s
    WHERE LTRIM(RTRIM(s.[Call Recording])) = LTRIM(RTRIM(i.recordingUrl)) COLLATE DATABASE_DEFAULT
  );
GO
