-- ============================================================================
-- SURVEY RESPONSES: Table creation + sync from source
-- Run against: ai_insights database
-- ============================================================================

-- 1. Create the table
-- ============================================================================

CREATE TABLE app.survey_responses (
  id_opportunity          INT NOT NULL PRIMARY KEY,

  -- Context
  campaign                NVARCHAR(200)   NULL,
  sub_campaign            NVARCHAR(200)   NULL,
  manufacture             NVARCHAR(100)   NULL,
  model                   NVARCHAR(200)   NULL,
  dealer                  NVARCHAR(200)   NULL,
  dealer_code             NVARCHAR(50)    NULL,
  prospect_type           NVARCHAR(100)   NULL,
  source_type             NVARCHAR(100)   NULL,
  product_type            NVARCHAR(100)   NULL,

  -- Outcome / Result
  result_code_desc        NVARCHAR(200)   NULL,
  category                NVARCHAR(100)   NULL,
  outcome                 INT             NULL,
  positive_outcome        BIT             NULL,
  neutral_outcome         BIT             NULL,
  negative_outcome        BIT             NULL,

  -- Dates
  allocation_date         DATETIME        NULL,
  first_attempt_date      DATETIME        NULL,
  last_attempt_date       DATETIME        NULL,
  fpi_date                DATE            NULL,

  -- Agent
  id_agent                INT             NULL,
  result_code_plan        NVARCHAR(50)    NULL,

  -- Call info
  total_attempts          INT             NOT NULL DEFAULT 0,
  call_recording_url      NVARCHAR(500)   NULL,

  -- Survey status
  survey_data_status      NVARCHAR(50)    NULL,
  survey_flow_status      NVARCHAR(50)    NULL,

  -- P2: Purchase status
  p2_has_not_purchased_yet NVARCHAR(200)  NULL,
  p2_still_considering    NVARCHAR(50)    NULL,

  -- P3: Follow-up interest
  p3_interest_follow_up   NVARCHAR(50)    NULL,

  -- P4 Q1: Initial interest reasons
  initial_interest_styling     BIT         NULL,
  initial_interest_brand       BIT         NULL,
  initial_interest_features    BIT         NULL,
  initial_interest_size        BIT         NULL,
  initial_interest_performance BIT         NULL,
  initial_interest_price       BIT         NULL,
  initial_interest_other       NVARCHAR(500) NULL,

  -- P4 Q2: Dealer visit
  dealer_visit            NVARCHAR(100)   NULL,
  vehicle_impression      NVARCHAR(500)   NULL,
  why_no_test_drive       NVARCHAR(500)   NULL,

  -- P4 Q3: Dealership rating
  dealership_rating       INT             NULL,
  dealership_rating_feedback NVARCHAR(MAX) NULL,

  -- P4 Q4: Not purchase reasons
  not_purchased_price          BIT         NULL,
  not_purchased_expectations   BIT         NULL,
  not_purchased_different_brand BIT        NULL,
  not_purchased_different_model BIT        NULL,
  not_purchased_financing      BIT         NULL,
  not_purchased_dealership     BIT         NULL,
  purchased_moi_on_record      BIT         NULL,
  not_purchased_other          NVARCHAR(500) NULL,
  not_purchased_price_feedback NVARCHAR(MAX) NULL,

  -- P4 Q5: Competitor purchase
  purchased_another_vehicle    NVARCHAR(50)  NULL,
  purchased_make               NVARCHAR(100) NULL,
  purchased_model              NVARCHAR(200) NULL,
  purchased_other_model        NVARCHAR(200) NULL,
  purchased_new_used           NVARCHAR(50)  NULL,

  -- P4 Q6-Q9: Influence, reasoning, improvement
  purchase_influence       NVARCHAR(MAX)   NULL,
  purchase_reason          NVARCHAR(MAX)   NULL,
  improve_anything         NVARCHAR(MAX)   NULL,
  improve_follow_up        NVARCHAR(MAX)   NULL,

  -- Agent notes
  agent_notes              NVARCHAR(MAX)   NULL,

  -- Complaint
  complaint_type           NVARCHAR(200)   NULL,
  complaint_type_category  NVARCHAR(200)   NULL,

  -- Sync metadata
  synced_at                DATETIME        NOT NULL DEFAULT GETDATE()
);

-- 2. Indexes for analytics queries
-- ============================================================================

CREATE INDEX IX_survey_campaign         ON app.survey_responses (campaign);
CREATE INDEX IX_survey_manufacture      ON app.survey_responses (manufacture);
CREATE INDEX IX_survey_model            ON app.survey_responses (model);
CREATE INDEX IX_survey_dealer           ON app.survey_responses (dealer);
CREATE INDEX IX_survey_category         ON app.survey_responses (category);
CREATE INDEX IX_survey_result_code_desc ON app.survey_responses (result_code_desc);
CREATE INDEX IX_survey_allocation_date  ON app.survey_responses (allocation_date);
CREATE INDEX IX_survey_flow_status      ON app.survey_responses (survey_flow_status);
CREATE INDEX IX_survey_purchased_make   ON app.survey_responses (purchased_make);
CREATE INDEX IX_survey_id_agent         ON app.survey_responses (id_agent);
CREATE INDEX IX_survey_data_status      ON app.survey_responses (survey_data_status);

-- 3. Sync procedure: MERGE from source into ai_insights
-- ============================================================================
-- Adjust [icx-rep].[bi].[LeadDataSurvey_NMGB] if source table name differs.
-- This does an upsert: inserts new rows, updates changed rows, based on IDOpportunity.

CREATE OR ALTER PROCEDURE app.sync_survey_responses
AS
BEGIN
  SET NOCOUNT ON;

  MERGE app.survey_responses AS tgt
  USING (
    SELECT
      [IDOpportunity],
      [Campaign],
      [Sub Campaign],
      [Manufacture],
      [Model],
      [Dealer],
      [DealerCode],
      [Prospect Type],
      [Source Type],
      [Product Type],
      [Result Code Desc],
      [Category],
      [Outcome],
      [Positive Outcomes],
      [Neutral Outcomes],
      [Negative Outcomes],
      [Allocation Date Time],
      [First Attempt Date Time],
      [Last Attempt Date Time],
      CASE
        WHEN [FPI Date] IS NOT NULL AND [FPI Date] > 0
          THEN TRY_CAST(CAST([FPI Date] AS VARCHAR(8)) AS DATE)
        ELSE NULL
      END AS fpi_date_parsed,
      [IDAgent],
      [Result Code Plan],
      [Total Attempts],
      [Call Recording],
      [Survey Data Status],
      [Survey Flow Status],
      [P2 Q1 Has Not Purchased Yet],
      [P2 Q2 Still Considering],
      [P3 Q1 Interest Follow Up],
      [P4 Q1 Initial Interest Styling Design],
      [P4 Q1 Initial Interest Brand Reputation],
      [P4 Q1 Initial Interest Features],
      [P4 Q1 Initial Interest Size Practicality],
      [P4 Q1 Initial Interest Performance],
      [P4 Q1 Initial Interest Price Value],
      [P4 Q1 Initial Interest Other],
      [P4 Q2 Did you visit],
      [P4 Q2a Impression of Vehicle],
      [P4 Q2b Why No Test Drive],
      [P4 Q3 Dealership Rating],
      [P4 Q3a Dealership Rating Feedback],
      [P4 Q4 Not Purchase Reason Price],
      [P4 Q4 Not Purchase Reason Expectations],
      [P4 Q4 Not Purchase Reason Purchase Different Brand],
      [P4 Q4 Not Purchase Reason Purchase Different Client Model],
      [P4 Q4 Not Purchase Reason Financing],
      [P4 Q4 Not Purchase Reason Dealership Experience],
      [P4 Q4 Purchased MOI on Record],
      [P4 Q4 Not Purchase Reason Other],
      [P4 Q4a Not Purchase Reason Price Feedback],
      [P4 Q5 Purchase Another Vehicle],
      [P4 Q5 Purchase Make],
      [P4 Q5 Purchase Model],
      [P4 Q5 Purchase Other Model Not Listed],
      [P4 Q5 Purchase New Used],
      [P4 Q6 Purchase Another Influence],
      [P4 Q7 Purchase Reason For],
      [P4 Q8 Improve Anything Different],
      [P4 Q9 Improve Follow Up],
      [Agent Notes],
      [Complaint Type],
      [Complaint Type Category]
    FROM [icx-rep].[bi].[LeadDataSurvey_NMGB]
  ) AS src ON tgt.id_opportunity = src.[IDOpportunity]

  WHEN MATCHED THEN UPDATE SET
    tgt.campaign                    = src.[Campaign],
    tgt.sub_campaign                = src.[Sub Campaign],
    tgt.manufacture                 = src.[Manufacture],
    tgt.model                       = src.[Model],
    tgt.dealer                      = src.[Dealer],
    tgt.dealer_code                 = src.[DealerCode],
    tgt.prospect_type               = src.[Prospect Type],
    tgt.source_type                 = src.[Source Type],
    tgt.product_type                = src.[Product Type],
    tgt.result_code_desc            = src.[Result Code Desc],
    tgt.category                    = src.[Category],
    tgt.outcome                     = src.[Outcome],
    tgt.positive_outcome            = CASE WHEN src.[Positive Outcomes] = 1 THEN 1 ELSE 0 END,
    tgt.neutral_outcome             = CASE WHEN src.[Neutral Outcomes] = 1 THEN 1 ELSE 0 END,
    tgt.negative_outcome            = CASE WHEN src.[Negative Outcomes] = 1 THEN 1 ELSE 0 END,
    tgt.allocation_date             = src.[Allocation Date Time],
    tgt.first_attempt_date          = src.[First Attempt Date Time],
    tgt.last_attempt_date           = src.[Last Attempt Date Time],
    tgt.fpi_date                    = src.fpi_date_parsed,
    tgt.id_agent                    = src.[IDAgent],
    tgt.result_code_plan            = src.[Result Code Plan],
    tgt.total_attempts              = ISNULL(src.[Total Attempts], 0),
    tgt.call_recording_url          = src.[Call Recording],
    tgt.survey_data_status          = src.[Survey Data Status],
    tgt.survey_flow_status          = src.[Survey Flow Status],
    tgt.p2_has_not_purchased_yet    = src.[P2 Q1 Has Not Purchased Yet],
    tgt.p2_still_considering        = src.[P2 Q2 Still Considering],
    tgt.p3_interest_follow_up       = src.[P3 Q1 Interest Follow Up],
    tgt.initial_interest_styling    = src.[P4 Q1 Initial Interest Styling Design],
    tgt.initial_interest_brand      = src.[P4 Q1 Initial Interest Brand Reputation],
    tgt.initial_interest_features   = src.[P4 Q1 Initial Interest Features],
    tgt.initial_interest_size       = src.[P4 Q1 Initial Interest Size Practicality],
    tgt.initial_interest_performance= src.[P4 Q1 Initial Interest Performance],
    tgt.initial_interest_price      = src.[P4 Q1 Initial Interest Price Value],
    tgt.initial_interest_other      = src.[P4 Q1 Initial Interest Other],
    tgt.dealer_visit                = src.[P4 Q2 Did you visit],
    tgt.vehicle_impression          = src.[P4 Q2a Impression of Vehicle],
    tgt.why_no_test_drive           = src.[P4 Q2b Why No Test Drive],
    tgt.dealership_rating           = src.[P4 Q3 Dealership Rating],
    tgt.dealership_rating_feedback  = src.[P4 Q3a Dealership Rating Feedback],
    tgt.not_purchased_price         = src.[P4 Q4 Not Purchase Reason Price],
    tgt.not_purchased_expectations  = src.[P4 Q4 Not Purchase Reason Expectations],
    tgt.not_purchased_different_brand = src.[P4 Q4 Not Purchase Reason Purchase Different Brand],
    tgt.not_purchased_different_model = src.[P4 Q4 Not Purchase Reason Purchase Different Client Model],
    tgt.not_purchased_financing     = src.[P4 Q4 Not Purchase Reason Financing],
    tgt.not_purchased_dealership    = src.[P4 Q4 Not Purchase Reason Dealership Experience],
    tgt.purchased_moi_on_record     = src.[P4 Q4 Purchased MOI on Record],
    tgt.not_purchased_other         = src.[P4 Q4 Not Purchase Reason Other],
    tgt.not_purchased_price_feedback= src.[P4 Q4a Not Purchase Reason Price Feedback],
    tgt.purchased_another_vehicle   = src.[P4 Q5 Purchase Another Vehicle],
    tgt.purchased_make              = src.[P4 Q5 Purchase Make],
    tgt.purchased_model             = src.[P4 Q5 Purchase Model],
    tgt.purchased_other_model       = src.[P4 Q5 Purchase Other Model Not Listed],
    tgt.purchased_new_used          = src.[P4 Q5 Purchase New Used],
    tgt.purchase_influence          = src.[P4 Q6 Purchase Another Influence],
    tgt.purchase_reason             = src.[P4 Q7 Purchase Reason For],
    tgt.improve_anything            = src.[P4 Q8 Improve Anything Different],
    tgt.improve_follow_up           = src.[P4 Q9 Improve Follow Up],
    tgt.agent_notes                 = src.[Agent Notes],
    tgt.complaint_type              = src.[Complaint Type],
    tgt.complaint_type_category     = src.[Complaint Type Category],
    tgt.synced_at                   = GETDATE()

  WHEN NOT MATCHED BY TARGET THEN INSERT (
    id_opportunity, campaign, sub_campaign, manufacture, model, dealer, dealer_code,
    prospect_type, source_type, product_type, result_code_desc, category, outcome,
    positive_outcome, neutral_outcome, negative_outcome,
    allocation_date, first_attempt_date, last_attempt_date, fpi_date,
    id_agent, result_code_plan, total_attempts, call_recording_url,
    survey_data_status, survey_flow_status,
    p2_has_not_purchased_yet, p2_still_considering, p3_interest_follow_up,
    initial_interest_styling, initial_interest_brand, initial_interest_features,
    initial_interest_size, initial_interest_performance, initial_interest_price,
    initial_interest_other,
    dealer_visit, vehicle_impression, why_no_test_drive,
    dealership_rating, dealership_rating_feedback,
    not_purchased_price, not_purchased_expectations, not_purchased_different_brand,
    not_purchased_different_model, not_purchased_financing, not_purchased_dealership,
    purchased_moi_on_record, not_purchased_other, not_purchased_price_feedback,
    purchased_another_vehicle, purchased_make, purchased_model,
    purchased_other_model, purchased_new_used,
    purchase_influence, purchase_reason, improve_anything, improve_follow_up,
    agent_notes, complaint_type, complaint_type_category, synced_at
  ) VALUES (
    src.[IDOpportunity], src.[Campaign], src.[Sub Campaign], src.[Manufacture], src.[Model],
    src.[Dealer], src.[DealerCode], src.[Prospect Type], src.[Source Type], src.[Product Type],
    src.[Result Code Desc], src.[Category], src.[Outcome],
    CASE WHEN src.[Positive Outcomes] = 1 THEN 1 ELSE 0 END,
    CASE WHEN src.[Neutral Outcomes] = 1 THEN 1 ELSE 0 END,
    CASE WHEN src.[Negative Outcomes] = 1 THEN 1 ELSE 0 END,
    src.[Allocation Date Time], src.[First Attempt Date Time], src.[Last Attempt Date Time],
    src.fpi_date_parsed,
    src.[IDAgent], src.[Result Code Plan], ISNULL(src.[Total Attempts], 0), src.[Call Recording],
    src.[Survey Data Status], src.[Survey Flow Status],
    src.[P2 Q1 Has Not Purchased Yet], src.[P2 Q2 Still Considering], src.[P3 Q1 Interest Follow Up],
    src.[P4 Q1 Initial Interest Styling Design], src.[P4 Q1 Initial Interest Brand Reputation],
    src.[P4 Q1 Initial Interest Features], src.[P4 Q1 Initial Interest Size Practicality],
    src.[P4 Q1 Initial Interest Performance], src.[P4 Q1 Initial Interest Price Value],
    src.[P4 Q1 Initial Interest Other],
    src.[P4 Q2 Did you visit], src.[P4 Q2a Impression of Vehicle], src.[P4 Q2b Why No Test Drive],
    src.[P4 Q3 Dealership Rating], src.[P4 Q3a Dealership Rating Feedback],
    src.[P4 Q4 Not Purchase Reason Price], src.[P4 Q4 Not Purchase Reason Expectations],
    src.[P4 Q4 Not Purchase Reason Purchase Different Brand],
    src.[P4 Q4 Not Purchase Reason Purchase Different Client Model],
    src.[P4 Q4 Not Purchase Reason Financing], src.[P4 Q4 Not Purchase Reason Dealership Experience],
    src.[P4 Q4 Purchased MOI on Record], src.[P4 Q4 Not Purchase Reason Other],
    src.[P4 Q4a Not Purchase Reason Price Feedback],
    src.[P4 Q5 Purchase Another Vehicle], src.[P4 Q5 Purchase Make], src.[P4 Q5 Purchase Model],
    src.[P4 Q5 Purchase Other Model Not Listed], src.[P4 Q5 Purchase New Used],
    src.[P4 Q6 Purchase Another Influence], src.[P4 Q7 Purchase Reason For],
    src.[P4 Q8 Improve Anything Different], src.[P4 Q9 Improve Follow Up],
    src.[Agent Notes], src.[Complaint Type], src.[Complaint Type Category], GETDATE()
  );
END;
GO

-- 4. Run initial sync
-- ============================================================================
EXEC app.sync_survey_responses;
GO
