<template>
  <Teleport to="body">
    <div v-if="recordingId" class="drawer-backdrop" @click="onClose" />
    <Transition name="drawer">
      <div v-if="recordingId" class="drawer">
        <div class="drawer-header">
          <div class="drawer-header-left">
            <div class="drawer-title">Interaction Detail</div>
            <div v-if="detailData" class="drawer-header-sub">
              <span v-if="detailData.interaction?.agent">{{ detailData.interaction.agent }}</span>
              <span v-if="detailData.interaction?.agent && detailData.interaction?.campaign" class="drawer-header-sep">/</span>
              <span v-if="detailData.interaction?.campaign">{{ detailData.interaction.campaign }}</span>
            </div>
          </div>
          <div class="drawer-header-right">
            <span
              v-if="opsPartialActive"
              class="drawer-flag drawer-flag--ops-partial"
              :title="opsPartialTitle"
            >Partial</span>
            <span
              v-if="opsLowScoreActive"
              class="drawer-flag drawer-flag--ops-low"
              :title="opsLowScoreTitle"
            >Low score</span>
            <span
              v-if="qaPartialActive"
              class="drawer-flag drawer-flag--qa-partial"
              :title="qaPartialTitle"
            >QA partial</span>
            <span
              v-if="qaLowScoreActive"
              class="drawer-flag drawer-flag--qa-low"
              :title="qaLowScoreTitle"
            >QA low score</span>
            <span
              v-if="chatResponseBreached"
              class="drawer-flag drawer-flag--rt-breach"
              :title="chatResponseBreachTitle"
            >SLA breach</span>
            <span
              v-if="detailData?.insight?.overall_score != null"
              class="drawer-header-score"
              :style="{ background: scoreColorSolid(detailData.insight.overall_score) }"
            >{{ fmtScore(detailData.insight.overall_score) }}</span>
            <button class="drawer-close" @click="onClose">&times;</button>
          </div>
        </div>
        <div class="drawer-body">
          <div v-if="loadingDetail" class="hint" style="padding: 24px">Loading detail...</div>
          <div v-else-if="!detailData" class="hint" style="padding: 24px">Could not load detail.</div>
          <template v-else>
            <div class="drawer-columns">
              <!-- LEFT COLUMN: metadata, scores, QA -->
              <div class="drawer-col">
                <!-- Metadata -->
                <div class="drawer-section">
                  <div class="drawer-section-title">Metadata</div>
                  <div class="drawer-meta-grid">
                    <div><span class="drawer-label">Agent</span><span class="drawer-value">{{ detailData.interaction.agent || "n/a" }}</span></div>
                    <div><span class="drawer-label">Campaign</span><span class="drawer-value">{{ detailData.interaction.campaign || "n/a" }}</span></div>
                    <div><span class="drawer-label">Type</span><span class="drawer-value">{{ detailData.interaction.interactionType || "n/a" }}</span></div>
                    <div><span class="drawer-label">Date</span><span class="drawer-value">{{ fmtDate(detailData.interaction.interactionDateTime) }}</span></div>
                    <div v-if="detailData.interaction.interactionId"><span class="drawer-label">Interaction ID</span><span class="drawer-value mono" style="font-size: 12px">{{ detailData.interaction.interactionId }}</span></div>
                    <div v-if="detailData.interaction.interactionTpsId"><span class="drawer-label">TPS ID</span><span class="drawer-value mono" style="font-size: 12px">{{ detailData.interaction.interactionTpsId }}</span></div>
                    <div v-if="detailData.interaction.interactionSource"><span class="drawer-label">Source</span><span class="drawer-value">{{ detailData.interaction.interactionSource }}</span></div>
                    <div><span class="drawer-label">Status</span><span class="chip chip--secondary">{{ detailData.interaction.status }}</span></div>
                    <div v-if="detailData.interaction.outcome"><span class="drawer-label">Outcome</span><span class="chip chip--secondary">{{ detailData.interaction.outcome }}</span></div>
                  </div>
                  <div v-if="detailData.interaction.recordingUrl && !isChat" class="audio-player">
                    <div class="drawer-label" style="margin-bottom: 6px">Recording</div>
                    <audio controls preload="none" :src="detailData.interaction.recordingUrl" class="audio-el">
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                </div>

                <!-- Scores -->
                <div v-if="detailData.insight" class="drawer-section">
                  <div class="drawer-section-title">Scores</div>
                  <div class="stats-strip" style="margin-bottom: 10px">
                    <div class="stat">
                      <div class="stat-label">Overall</div>
                      <div class="stat-value" :class="scoreChip(detailData.insight.overall_score)">{{ fmtScore(detailData.insight.overall_score) }}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Sentiment</div>
                      <div class="stat-value">{{ fmtScore(detailData.insight.sentiment_overall) }}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Disposition</div>
                      <div class="stat-value chip chip--secondary" style="font-size: 12px">{{ detailData.insight.contact_disposition || "n/a" }}</div>
                    </div>
                  </div>

                  <div v-if="detailData.insight.operations_scores" style="margin-top: 8px">
                    <div
                      v-for="(dim, key) in detailData.insight.operations_scores"
                      :key="key"
                      class="dim-row dim-row--hover"
                      style="margin-bottom: 6px"
                      :title="dimensionTooltip(String(key), dim)"
                    >
                      <div class="dim-label" style="min-width: 130px">{{ String(key).replace(/_/g, ' ') }}</div>
                      <div class="dim-bars" style="flex: 1">
                        <div class="dim-bar-track">
                          <div class="dim-bar" :style="{ width: (dim?.score ?? 0) / 10 * 100 + '%', background: scoreColor(dim?.score ?? null) }" />
                        </div>
                      </div>
                      <span class="dim-chip" :style="{ background: scoreColorSolid(dim?.score ?? null), color: '#fff', fontSize: '11px', minWidth: '36px', textAlign: 'center' }">{{ fmtScore(dim?.score ?? null) }}</span>
                    </div>
                  </div>
                </div>

                <!-- QA Assessment -->
                <div v-if="detailData.insight?.qa_scores?.scores" class="drawer-section">
                  <div class="drawer-section-title">QA Assessment</div>
                  <div v-if="detailData.insight.qa_scores.overall_score != null" style="margin-bottom: 10px; display: flex; align-items: center; gap: 8px">
                    <span style="font-size: 12px; font-weight: 700; color: var(--ink)">Overall QA Score</span>
                    <span
                      class="dim-chip"
                      :style="{ background: scoreColorSolid(detailData.insight.qa_scores.overall_score), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                    >{{ fmtQaScore(detailData.insight.qa_scores.overall_score) }}</span>
                  </div>
                  <template v-for="(section, sectionKey) in detailData.insight.qa_scores.scores" :key="sectionKey">
                    <div v-if="typeof section === 'object' && section !== null && 'section_score' in section" class="qa-section">
                      <div class="qa-section-header">
                        <span class="qa-section-title">{{ String(sectionKey).replace(/_/g, ' ') }}</span>
                        <span
                          class="dim-chip"
                          :style="{ background: scoreColorSolid(section.section_score), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                        >{{ fmtQaScore(section.section_score) }}</span>
                      </div>
                      <div v-for="(q, qKey) in section" :key="qKey" class="qa-row">
                        <template v-if="typeof q === 'object' && q !== null && 'answer' in q">
                          <div class="qa-label">{{ qaQuestionLabels[String(qKey)] || String(qKey).replace(/_/g, ' ') }}</div>
                          <span
                            class="chip"
                            :class="q.answer === 'yes' ? 'chip--success' : q.answer === 'no' ? 'chip--danger' : 'chip--secondary'"
                            style="font-size: 11px"
                          >{{ q.answer }}</span>
                          <div class="qa-rationale">{{ q.rationale }}</div>
                        </template>
                      </div>
                    </div>
                  </template>
                </div>
              </div>

              <!-- MIDDLE COLUMN -->
              <div class="drawer-col">
                <!-- Summary -->
                <div v-if="detailData.insight" class="drawer-section">
                  <div class="drawer-section-title">Summary</div>
                  <p style="margin: 0 0 8px; font-weight: 600">{{ detailData.insight.summary_short }}</p>
                  <p v-if="detailData.insight.summary_detailed" style="margin: 0; line-height: 1.6; color: var(--ink)">{{ detailData.insight.summary_detailed }}</p>
                </div>

                <!-- Chat Response Time -->
                <div v-if="chatResponse" class="drawer-section">
                  <div class="drawer-section-title">
                    Chat Response Time
                    <span
                      v-if="chatResponseBreached"
                      class="chip chip--danger"
                      style="font-size: 10px; margin-left: 8px"
                      :title="chatResponseBreachTitle"
                    >{{ chatResponse.sla_breach_count }} SLA breach{{ chatResponse.sla_breach_count === 1 ? '' : 'es' }}</span>
                    <span
                      v-else-if="chatResponse.measured_count > 0"
                      class="chip chip--success"
                      style="font-size: 10px; margin-left: 8px"
                      title="No agent reply exceeded the SLA in this chat."
                    >Within SLA</span>
                  </div>
                  <div class="stats-strip" style="margin-bottom: 10px">
                    <div class="stat">
                      <div class="stat-label">Avg</div>
                      <div class="stat-value" :class="responseTimeChip(chatResponse.avg_seconds, chatResponse.sla_threshold_seconds)">{{ fmtSeconds(chatResponse.avg_seconds) }}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Longest</div>
                      <div class="stat-value" :class="responseTimeChip(chatResponse.longest_seconds, chatResponse.sla_threshold_seconds)">{{ fmtSeconds(chatResponse.longest_seconds) }}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Last reply</div>
                      <div class="stat-value" :class="responseTimeChip(chatResponse.last_seconds, chatResponse.sla_threshold_seconds)">{{ fmtSeconds(chatResponse.last_seconds) }}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Turns</div>
                      <div class="stat-value chip chip--secondary" style="font-size: 12px">{{ chatResponse.measured_count ?? 0 }}</div>
                    </div>
                  </div>
                  <div v-if="chatResponse.pairs?.length" class="rt-pairs">
                    <div
                      v-for="(p, i) in chatResponse.pairs"
                      :key="i"
                      class="rt-pair"
                      :class="{
                        'rt-pair--auto': p.is_auto_message,
                        'rt-pair--breach': !p.is_auto_message && typeof p.gap_seconds === 'number' && p.gap_seconds > chatResponse.sla_threshold_seconds,
                        'rt-pair--unanswered': !p.is_auto_message && p.gap_seconds === null && p.agent_at === null,
                      }"
                    >
                      <div class="rt-pair-meta">
                        <span v-if="p.customer_at" class="rt-pair-ts mono">{{ p.customer_at }}</span>
                        <span v-if="p.customer_at && p.agent_at" class="rt-pair-arrow">→</span>
                        <span v-if="p.agent_at" class="rt-pair-ts mono">{{ p.agent_at }}</span>
                        <span
                          v-if="p.is_auto_message"
                          class="chip chip--secondary"
                          style="font-size: 10px"
                        >auto-message</span>
                        <span
                          v-else-if="p.gap_seconds === null && p.agent_at === null"
                          class="chip chip--warning"
                          style="font-size: 10px"
                        >no reply</span>
                        <span
                          v-else-if="typeof p.gap_seconds === 'number'"
                          class="chip"
                          :class="responseTimeChip(p.gap_seconds, chatResponse.sla_threshold_seconds)"
                          style="font-size: 10px"
                        >{{ fmtSeconds(p.gap_seconds) }}</span>
                        <span v-if="p.is_last_pair" class="chip chip--secondary" style="font-size: 10px">last</span>
                      </div>
                      <div v-if="p.agent_message_preview" class="rt-pair-preview">"{{ p.agent_message_preview }}"</div>
                    </div>
                  </div>
                </div>

                <!-- Coaching -->
                <div v-if="detailData.insight?.coaching" class="drawer-section">
                  <div class="drawer-section-title">Coaching</div>
                  <div v-if="detailData.insight.coaching.did_well?.length" style="margin-bottom: 8px">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--success, #22c55e); margin-bottom: 4px">Did Well</div>
                    <ul class="drawer-list">
                      <li v-for="(item, i) in detailData.insight.coaching.did_well" :key="i">{{ item }}</li>
                    </ul>
                  </div>
                  <div v-if="detailData.insight.coaching.needs_improvement?.length">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--danger, #ef4444); margin-bottom: 4px">Needs Improvement</div>
                    <ul class="drawer-list">
                      <li v-for="(item, i) in detailData.insight.coaching.needs_improvement" :key="i">{{ item }}</li>
                    </ul>
                  </div>
                </div>

                <!-- Action Items -->
                <div v-if="detailData.insight?.action_items?.length" class="drawer-section">
                  <div class="drawer-section-title">Action Items</div>
                  <ul class="drawer-list">
                    <li v-for="(item, i) in detailData.insight.action_items" :key="i">
                      <template v-if="typeof item === 'string'">{{ item }}</template>
                      <template v-else>{{ item.description || item.action || JSON.stringify(item) }}</template>
                    </li>
                  </ul>
                </div>

                <!-- Objections -->
                <div v-if="detailData.insight?.objections?.length" class="drawer-section">
                  <div class="drawer-section-title">Objections</div>
                  <ul class="drawer-list">
                    <li v-for="(obj, i) in detailData.insight.objections" :key="i">{{ obj }}</li>
                  </ul>
                </div>

                <!-- Objection Handling Assessment -->
                <div v-if="detailData.insight?.objection_assessment?.categories" class="drawer-section">
                  <div class="drawer-section-title">Objection Handling Assessment</div>

                  <div v-if="detailData.insight.objection_assessment.overall_handling_comment" style="margin-bottom: 10px; font-style: italic; color: var(--ink); font-size: 12px; line-height: 1.5">
                    {{ detailData.insight.objection_assessment.overall_handling_comment }}
                  </div>

                  <div v-for="(cat, catKey) in detailData.insight.objection_assessment.categories" :key="catKey">
                    <div v-if="cat.raised" class="objection-cat-row">
                      <div class="objection-cat-label">{{ String(catKey).replace(/_/g, ' ') }}</div>
                      <div class="objection-cat-flags">
                        <span class="chip" :class="cat.best_practice_followed ? 'chip--success' : 'chip--danger'" style="font-size: 10px">
                          {{ cat.best_practice_followed ? 'Best practice ✓' : 'Best practice ✗' }}
                        </span>
                        <span v-if="cat.could_do_more" class="chip chip--warning" style="font-size: 10px">Could do more</span>
                      </div>
                      <div v-if="cat.comment && cat.comment !== 'Not raised'" class="objection-cat-comment">{{ cat.comment }}</div>
                    </div>
                  </div>

                  <div v-if="detailData.insight.objection_assessment.objections_raised_count === 0" style="font-size: 12px; color: var(--muted)">
                    No objections identified in this interaction.
                  </div>

                  <div v-if="detailData.insight.objection_assessment.objections_raised_count > 0 && detailData.insight.objection_assessment.generic_checklist" style="margin-top: 12px">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink); margin-bottom: 6px">Handling Checklist</div>
                    <div v-if="detailData.insight.objection_assessment.checklist_score != null" style="margin-bottom: 6px; font-size: 11px; color: var(--ink)">
                      <strong>Checklist score:</strong> {{ (detailData.insight.objection_assessment.checklist_score * 100).toFixed(0) }}%
                    </div>
                    <div class="checklist-grid">
                      <div v-for="(val, key) in detailData.insight.objection_assessment.generic_checklist" :key="key" class="checklist-item">
                        <span class="chip" :class="val === true ? 'chip--success' : val === false ? 'chip--danger' : 'chip--secondary'" style="font-size: 10px; min-width: 16px; text-align: center">
                          {{ val === true ? '✓' : val === false ? '✗' : '—' }}
                        </span>
                        <span style="font-size: 11px; color: var(--ink)">{{ String(key).replace(/_/g, ' ') }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- RIGHT COLUMN -->
              <div class="drawer-col">
                <!-- Opportunity Classification -->
                <div v-if="detailData.insight?.opportunity?.is_opportunity !== null && detailData.insight?.opportunity?.is_opportunity !== undefined" class="drawer-section">
                  <div class="drawer-section-title">Opportunity Classification</div>
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
                    <span
                      class="chip"
                      :class="detailData.insight.opportunity.is_opportunity ? 'chip--success' : 'chip--danger'"
                      style="font-size: 12px"
                    >{{ detailData.insight.opportunity.is_opportunity ? 'Opportunity to Sell' : 'Not an Opportunity' }}</span>
                    <span
                      v-if="!detailData.insight.opportunity.is_opportunity && detailData.insight.opportunity.not_opportunity_reason"
                      class="chip chip--secondary"
                      style="font-size: 11px"
                    >{{ opportunityReasonLabel(detailData.insight.opportunity.not_opportunity_reason) }}</span>
                  </div>
                  <p
                    v-if="detailData.insight.opportunity.detail?.reason_detail"
                    style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink)"
                  >{{ detailData.insight.opportunity.detail.reason_detail }}</p>
                </div>

                <!-- Campaign Q&A — Customer Position -->
                <div v-if="campaignAnswers" class="drawer-section">
                  <div class="drawer-section-title">Campaign Q&A — Customer Position</div>

                  <!-- Headline answers: consent + decision -->
                  <div class="parity-row parity-row--headline">
                    <div class="parity-row-label">Consent to pass to dealer</div>
                    <span class="chip" :class="answerChip(campaignAnswers.consent_to_dealer?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.consent_to_dealer?.answer) }}
                    </span>
                    <div v-if="campaignAnswers.consent_to_dealer?.quote" class="parity-quote">"{{ campaignAnswers.consent_to_dealer.quote }}"</div>
                  </div>

                  <div class="parity-row">
                    <div class="parity-row-label">Already decided</div>
                    <span class="chip" :class="answerChip(campaignAnswers.decision_made?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.decision_made?.answer) }}
                    </span>
                    <div v-if="campaignAnswers.decision_made?.detail" class="parity-detail">{{ campaignAnswers.decision_made.detail }}</div>
                    <div v-if="campaignAnswers.decision_made?.quote" class="parity-quote">"{{ campaignAnswers.decision_made.quote }}"</div>
                  </div>

                  <!-- Views on current setup -->
                  <div class="parity-subheader">Views on current setup</div>
                  <div v-for="viewKey in viewKeys" :key="viewKey" class="parity-row">
                    <div class="parity-row-label">{{ viewLabels[viewKey] }}</div>
                    <span
                      class="chip"
                      :class="viewChip(campaignAnswers[viewKey])"
                      style="font-size: 11px"
                    >{{ viewLabel(campaignAnswers[viewKey]) }}</span>
                    <div v-if="campaignAnswers[viewKey]?.answer === 'yes' && campaignAnswers[viewKey]?.summary" class="parity-detail">{{ campaignAnswers[viewKey].summary }}</div>
                    <div v-if="campaignAnswers[viewKey]?.quote" class="parity-quote">"{{ campaignAnswers[viewKey].quote }}"</div>
                  </div>

                  <!-- Constraints -->
                  <div class="parity-subheader">Constraints &amp; circumstances</div>
                  <div class="parity-row">
                    <div class="parity-row-label">Affordability issues</div>
                    <span class="chip" :class="answerChip(campaignAnswers.affordability_issues?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.affordability_issues?.answer) }}
                    </span>
                    <div v-if="campaignAnswers.affordability_issues?.detail" class="parity-detail">{{ campaignAnswers.affordability_issues.detail }}</div>
                    <div v-if="campaignAnswers.affordability_issues?.quote" class="parity-quote">"{{ campaignAnswers.affordability_issues.quote }}"</div>
                  </div>
                  <div class="parity-row">
                    <div class="parity-row-label">Lifestyle change</div>
                    <span class="chip" :class="answerChip(campaignAnswers.lifestyle_change_vehicle?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.lifestyle_change_vehicle?.answer) }}
                    </span>
                    <div v-if="campaignAnswers.lifestyle_change_vehicle?.detail" class="parity-detail">{{ campaignAnswers.lifestyle_change_vehicle.detail }}</div>
                    <div v-if="campaignAnswers.lifestyle_change_vehicle?.quote" class="parity-quote">"{{ campaignAnswers.lifestyle_change_vehicle.quote }}"</div>
                  </div>
                </div>

                <!-- Campaign Q&A — Competitor & Dealer Activity -->
                <div v-if="campaignAnswers" class="drawer-section">
                  <div class="drawer-section-title">Campaign Q&A — Competitor &amp; Dealer Activity</div>

                  <div class="parity-row">
                    <div class="parity-row-label">Dealer already in touch</div>
                    <span class="chip" :class="answerChip(campaignAnswers.dealer_already_in_touch?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.dealer_already_in_touch?.answer) }}
                    </span>
                    <div v-if="campaignAnswers.dealer_already_in_touch?.quote" class="parity-quote">"{{ campaignAnswers.dealer_already_in_touch.quote }}"</div>
                  </div>

                  <div class="parity-row parity-row--headline">
                    <div class="parity-row-label">Looking at a competitor</div>
                    <span class="chip" :class="answerChip(campaignAnswers.competitor_vehicle?.answer)" style="font-size: 11px">
                      {{ formatAnswer(campaignAnswers.competitor_vehicle?.answer) }}
                    </span>
                    <div
                      v-if="campaignAnswers.competitor_vehicle?.competitor_brand || campaignAnswers.competitor_vehicle?.competitor_model"
                      class="parity-detail"
                    >
                      <strong>{{ campaignAnswers.competitor_vehicle?.competitor_brand || '—' }}</strong>
                      <template v-if="campaignAnswers.competitor_vehicle?.competitor_model">
                        / {{ campaignAnswers.competitor_vehicle.competitor_model }}
                      </template>
                    </div>
                    <div v-if="campaignAnswers.competitor_vehicle?.quote" class="parity-quote">"{{ campaignAnswers.competitor_vehicle.quote }}"</div>
                  </div>

                  <div v-if="campaignAnswers.competitor_reasons?.reasons?.length" class="parity-row">
                    <div class="parity-row-label">Why competitor wins</div>
                    <div class="parity-chip-list">
                      <span
                        v-for="r in campaignAnswers.competitor_reasons.reasons"
                        :key="r"
                        class="chip chip--info"
                        style="font-size: 10px"
                      >{{ String(r).replace(/_/g, ' ') }}</span>
                    </div>
                    <div v-if="campaignAnswers.competitor_reasons.detail" class="parity-detail">{{ campaignAnswers.competitor_reasons.detail }}</div>
                    <div v-if="campaignAnswers.competitor_reasons.quote" class="parity-quote">"{{ campaignAnswers.competitor_reasons.quote }}"</div>
                  </div>

                  <div v-if="campaignAnswers.key_competitor_drivers?.length" class="parity-subheader">Headline competitor drivers</div>
                  <div
                    v-for="(d, i) in campaignAnswers.key_competitor_drivers"
                    :key="i"
                    class="parity-driver"
                  >
                    <div class="parity-driver-head">{{ d.driver }}</div>
                    <div v-if="d.explanation" class="parity-detail">{{ d.explanation }}</div>
                    <div v-if="d.quote" class="parity-quote">"{{ d.quote }}"</div>
                  </div>
                </div>

                <!-- Risk Flags -->
                <div v-if="detailData.insight?.risk_flags?.length" class="drawer-section">
                  <div class="drawer-section-title">Risk Flags</div>
                  <ul class="drawer-list">
                    <li v-for="(flag, i) in detailData.insight.risk_flags" :key="i">
                      <template v-if="typeof flag === 'string'">{{ flag }}</template>
                      <template v-else>
                        <span v-if="flag.risk_level" :class="flag.risk_level === 'high' ? 'chip chip--danger' : flag.risk_level === 'medium' ? 'chip chip--warning' : 'chip chip--success'" style="font-size: 11px; margin-right: 6px">{{ flag.risk_level }}</span>
                        {{ flag.description || flag.flag || JSON.stringify(flag) }}
                      </template>
                    </li>
                  </ul>
                </div>

                <!-- Transcript / Chat -->
                <div v-if="detailData.transcript" class="drawer-section">
                  <div class="drawer-section-title">
                    {{ isChat ? 'Chat Conversation' : 'Transcript' }}
                    <div v-if="isChat && chatMessages.length" class="chat-view-toggle">
                      <button
                        type="button"
                        class="chat-view-btn"
                        :class="{ 'chat-view-btn--active': chatView === 'bubbles' }"
                        @click="chatView = 'bubbles'"
                      >Chat</button>
                      <button
                        type="button"
                        class="chat-view-btn"
                        :class="{ 'chat-view-btn--active': chatView === 'raw' }"
                        @click="chatView = 'raw'"
                      >Raw</button>
                    </div>
                  </div>

                  <div v-if="isChat && chatMessages.length && chatView === 'bubbles'" class="chat-thread">
                    <div
                      v-for="msg in chatMessages"
                      :key="msg.id"
                      class="chat-msg"
                      :class="msg.source === 'Agent' ? 'chat-msg--agent' : 'chat-msg--customer'"
                    >
                      <div class="chat-bubble" :class="msg.source === 'Agent' ? 'chat-bubble--agent' : 'chat-bubble--customer'">
                        <div class="chat-sender">{{ msg.sender }}</div>
                        <div class="chat-content">{{ msg.content }}</div>
                        <div class="chat-time">{{ fmtTime(msg.timestamp) }}</div>
                      </div>
                    </div>
                  </div>

                  <pre v-else class="drawer-transcript">{{ detailData.transcript.text }}</pre>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getInteractionDetail } from "@/services/interaction-search.service";

const props = defineProps<{ recordingId: string | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const detailData = ref<any>(null);
const loadingDetail = ref(false);
// Default to the styled bubble view; user can opt into raw transcript per open.
const chatView = ref<"bubbles" | "raw">("bubbles");

watch(
  () => props.recordingId,
  async (id) => {
    chatView.value = "bubbles";
    if (!id) {
      detailData.value = null;
      return;
    }
    loadingDetail.value = true;
    detailData.value = null;
    try {
      detailData.value = await getInteractionDetail(id);
    } catch {
      detailData.value = null;
    } finally {
      loadingDetail.value = false;
    }
  },
  { immediate: true },
);

function onClose() {
  emit("close");
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const SCORE_RED = "#dc2626";
const SCORE_ORANGE = "#ea580c";
const SCORE_BLUE = "#0284c7";
const SCORE_GREEN = "#059669";

function fmtScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(1);
}

function fmtQaScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(2);
}

function scoreColorSolid(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  if (v >= 9) return SCORE_GREEN;
  if (v >= 7) return SCORE_BLUE;
  if (v >= 5) return SCORE_ORANGE;
  return SCORE_RED;
}

function scoreColor(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  let light: string, full: string;
  if (v >= 9) { light = "#a7f3d0"; full = SCORE_GREEN; }
  else if (v >= 7) { light = "#bae6fd"; full = SCORE_BLUE; }
  else if (v >= 5) { light = "#fed7aa"; full = SCORE_ORANGE; }
  else { light = "#fecaca"; full = SCORE_RED; }
  return `linear-gradient(90deg, ${light}, ${full})`;
}

function scoreChip(v: number | null | undefined) {
  if (typeof v !== "number") return "chip chip--secondary";
  if (v >= 9) return "chip bucket-chip--9plus";
  if (v >= 7) return "chip bucket-chip--7to9";
  if (v >= 5) return "chip bucket-chip--5to7";
  return "chip bucket-chip--below5";
}

function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(ts: string) {
  if (/^\d{2}:\d{2}:\d{2}$/.test(ts)) return ts.slice(0, 5);
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function dimensionTooltip(key: string, dim: any): string {
  const label = key.replace(/_/g, " ");
  const parts: string[] = [label];
  if (dim?.band) parts.push(`Band: ${dim.band}`);
  if (dim?.score == null && dim?.band == null) parts.push("Score: n/a");
  else if (dim?.score != null) parts.push(`Score: ${dim.score.toFixed(1)}`);
  if (dim?.rationale) parts.push(`\n${dim.rationale}`);
  if (dim?.timestamp_ref) parts.push(`@ ${dim.timestamp_ref}`);
  return parts.join(" — ").replace(/ — \n/g, "\n");
}

function opportunityReasonLabel(r: string) {
  const labels: Record<string, string> = {
    existing_policy: "Existing Policy",
    recent_policy_lapse: "Recent Policy (60 days)",
    renewal_enquiry: "Renewal Enquiry",
    cancellation_enquiry: "Cancellation Enquiry",
    policy_update: "Policy/Account Update",
    opt_out: "Opt Out Request",
    breakdown_report: "Breakdown Report",
    phone_line_complaint: "Phone Line Complaint",
    myrac_enquiry: "MyRAC Enquiry",
  };
  return labels[r] || r.replace(/_/g, " ");
}

const qaQuestionLabels: Record<string, string> = {
  q1_polite_friendly: "Q1 Polite & Friendly",
  q2_clear_understandable: "Q2 Clear & Understandable",
  q3_accurate_info: "Q3 Accurate Info",
  q4_next_steps_clear: "Q4 Next Steps Clear",
  q5_polite_friendly: "Q5 Polite & Friendly",
  q6_services_clear: "Q6 Services Clear",
  q7_next_steps_clear: "Q7 Next Steps Clear",
  q8_accurate_info: "Q8 Accurate Info",
  q9_id_verification: "Q9 ID Verification",
  q10_fair_not_misleading: "Q10 Fair & Not Misleading",
  q11_needs_established: "Q11 Needs Established",
  q12_best_interest: "Q12 Best Interest",
  q13_vulnerability: "Q13 Vulnerability",
  q14_brand_representation: "Q14 Brand Representation",
  q15_eligible_products: "Q15 Eligible Products",
};

const isChat = computed(
  () => detailData.value?.interaction?.interactionType === "chat",
);

// ─── campaign Q&A (e.g. Parity) ─────────────────────────────────────────────
const campaignAnswers = computed<any>(
  () => detailData.value?.insight?.campaign_answers ?? null,
);

const viewKeys = [
  "view_on_brand",
  "view_on_current_vehicle",
  "view_on_dealer",
  "view_on_finance_agreement",
] as const;

const viewLabels: Record<string, string> = {
  view_on_brand: "Current brand",
  view_on_current_vehicle: "Current vehicle",
  view_on_dealer: "Current dealer",
  view_on_finance_agreement: "Current finance agreement",
};

function answerChip(answer: string | null | undefined) {
  if (answer === "yes") return "chip--success";
  if (answer === "no") return "chip--danger";
  return "chip--secondary";
}

function formatAnswer(answer: string | null | undefined) {
  if (!answer) return "n/a";
  if (answer === "n_a" || answer === "n/a") return "n/a";
  return answer.charAt(0).toUpperCase() + answer.slice(1);
}

// Views are now a yes/no "expressed a negative view?" answer. Yes (a concern
// was raised) is the signal worth flagging, so it's shown in red.
function viewChip(view: any) {
  if (view?.answer === "yes") return "chip--danger";
  if (view?.answer === "no") return "chip--success";
  return "chip--secondary";
}

function viewLabel(view: any) {
  if (view?.answer === "yes") return "Negative view";
  if (view?.answer === "no") return "No concerns";
  return "Not raised";
}

// ─── scoring flags (partial / low-score alerts) ─────────────────────────────
// Ops-side and QA-side flags are kept separate so reviewers can tell at a
// glance which layer has the issue.

const opsFlags = computed<any>(
  () => detailData.value?.insight?.operations_flags ?? null,
);
const qaFlags = computed<any>(
  () => detailData.value?.insight?.qa_scores?.scoring_flags ?? null,
);

const opsPartialActive = computed(() =>
  Boolean(opsFlags.value?.partial_scoring),
);
const opsLowScoreActive = computed(() =>
  Boolean(opsFlags.value?.low_score_alert),
);
const qaPartialActive = computed(() =>
  Boolean(qaFlags.value?.partial_scoring),
);
const qaLowScoreActive = computed(() =>
  Boolean(qaFlags.value?.low_score_alert),
);

const opsPartialTitle = computed(
  () =>
    opsFlags.value?.partial_scoring_reason ||
    "Some operations dimensions returned n/a — overall score is based on a reduced set.",
);
const opsLowScoreTitle = computed(() => {
  const dims: string[] = opsFlags.value?.low_score_dimensions ?? [];
  return dims.length
    ? `Operations dimensions ≤ 4: ${dims.join(", ")}`
    : "One or more operations dimensions scored below the acceptable threshold.";
});
const qaPartialTitle = computed(
  () =>
    qaFlags.value?.partial_scoring_reason ||
    "Some QA questions answered n/a — QA overall score is based on a reduced set.",
);
const qaLowScoreTitle = computed(() => {
  const qs: string[] = qaFlags.value?.low_score_questions ?? [];
  return qs.length
    ? `QA questions answered "no": ${qs.join(", ")}`
    : "One or more QA questions were answered 'no'.";
});

// ─── chat response time ─────────────────────────────────────────────────────
const chatResponse = computed<any>(
  () => detailData.value?.insight?.chat_response ?? null,
);
const chatResponseBreached = computed(
  () => Boolean(chatResponse.value?.sla_breached),
);
const chatResponseBreachTitle = computed(() => {
  const r = chatResponse.value;
  if (!r) return "";
  const thresh = Math.round((r.sla_threshold_seconds ?? 180) / 60);
  return `${r.sla_breach_count} of ${r.measured_count} agent replies took longer than the ${thresh}-minute SLA.`;
});

function fmtSeconds(v: number | null | undefined) {
  if (typeof v !== "number" || !isFinite(v)) return "n/a";
  const rounded = Math.round(v);
  if (rounded < 60) return `${rounded}s`;
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function responseTimeChip(v: number | null | undefined, threshold: number) {
  if (typeof v !== "number") return "chip chip--secondary";
  if (v > threshold) return "chip bucket-chip--below5";
  if (v > 60) return "chip bucket-chip--5to7";
  return "chip bucket-chip--9plus";
}

interface ChatMessage {
  id: number;
  source: string;
  sender: string;
  timestamp: string;
  content: string;
}

function parseLineChatFormat(text: string): ChatMessage[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const re = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*([^:]+):\s*(.*)$/i;
  const msgs: ChatMessage[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const role = m[2]!.trim().toLowerCase();
      const source = role === "agent" ? "Agent" : "Customer";
      const sender = role === "agent" ? "Agent" : m[2]!.trim();
      msgs.push({ id: msgs.length, source, sender, timestamp: m[1]!, content: m[3] ?? "" });
    } else if (msgs.length) {
      msgs[msgs.length - 1]!.content += " " + line;
    } else {
      return [];
    }
  }
  return msgs;
}

const chatMessages = computed<ChatMessage[]>(() => {
  if (!isChat.value || !detailData.value?.transcript?.text) return [];
  let raw: string = detailData.value.transcript.text;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return [...parsed].sort(
        (a: ChatMessage, b: ChatMessage) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    }
    if (typeof parsed === "string") raw = parsed;
  } catch {
    /* not JSON */
  }
  const lineParsed = parseLineChatFormat(raw);
  if (lineParsed.length) return lineParsed;
  return [];
});
</script>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 999;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: min(1400px, 95vw);
  height: 100vh;
  background: var(--surface, #fff);
  border-left: 1px solid var(--border);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: linear-gradient(135deg, #1a3a5c 0%, #2b6cb0 100%);
  color: #fff;
  flex-shrink: 0;
}

.drawer-header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.drawer-title {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.02em;
}

.drawer-header-sub {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-sep {
  margin: 0 5px;
  opacity: 0.5;
}

.drawer-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.drawer-header-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
}

.drawer-flag {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #fff;
  cursor: help;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.3);
}
.drawer-flag--ops-partial {
  background: #b45309;
}
.drawer-flag--ops-low {
  background: #b91c1c;
}
.drawer-flag--qa-partial {
  background: #6d28d9;
}
.drawer-flag--qa-low {
  background: #be185d;
}
.drawer-flag--rt-breach {
  background: #c2410c;
}

/* Chat response-time per-turn pair list */
.rt-pairs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.rt-pair {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  border-left: 3px solid transparent;
}

.rt-pair--auto {
  opacity: 0.6;
  border-left-color: #94a3b8;
}

.rt-pair--breach {
  background: rgba(220, 38, 38, 0.08);
  border-left-color: #dc2626;
}

.rt-pair--unanswered {
  background: rgba(234, 88, 12, 0.08);
  border-left-color: #ea580c;
}

.rt-pair-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  flex-wrap: wrap;
}

.rt-pair-ts {
  color: var(--ink, #1f2937);
  font-weight: 600;
}

.rt-pair-arrow {
  color: var(--muted, #6b7280);
  font-size: 11px;
}

.rt-pair-preview {
  margin-top: 3px;
  font-size: 11px;
  color: var(--muted, #6b7280);
  font-style: italic;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-close {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  line-height: 1;
}

.drawer-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.drawer-columns {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  height: 100%;
}

.drawer-col {
  overflow-y: auto;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.drawer-col:last-child {
  border-right: none;
}

@media (max-width: 900px) {
  .drawer-columns {
    grid-template-columns: 1fr;
  }
  .drawer-col {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .drawer-col:last-child {
    border-bottom: none;
  }
}

.drawer-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.drawer-section-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand, #6366f1);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-view-toggle {
  display: inline-flex;
  margin-left: auto;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
}

.chat-view-btn {
  background: transparent;
  border: none;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--muted, #6b7280);
  cursor: pointer;
}

.chat-view-btn:not(:last-child) {
  border-right: 1px solid var(--border, #e5e7eb);
}

.chat-view-btn--active {
  background: var(--brand, #6366f1);
  color: #fff;
}

.drawer-meta-grid {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr;
  gap: 5px 10px;
  align-items: baseline;
}

.drawer-meta-grid > div {
  display: contents;
}

.drawer-value {
  font-size: 13px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.audio-player {
  margin-top: 12px;
}

.audio-el {
  width: 100%;
  height: 36px;
  border-radius: var(--radius-md, 6px);
}

.drawer-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
}

.stats-strip {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.dim-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.dim-row--hover {
  cursor: help;
  border-radius: 4px;
  padding: 2px 4px;
  margin-left: -4px;
  margin-right: -4px;
  transition: background 0.12s;
}
.dim-row--hover:hover {
  background: var(--surface-soft, #f1f5f9);
}

.dim-label {
  font-size: 12px;
  min-width: 140px;
  text-transform: capitalize;
  color: var(--ink);
}

.dim-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dim-bar-track {
  background: var(--surface-2, #e0e0e0);
  border-radius: 3px;
  height: 7px;
  overflow: hidden;
}

.dim-bar {
  height: 100%;
  transition: width 0.4s ease;
  border-radius: 3px;
}

.dim-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.bucket-chip--below5 {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #dc2626;
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
}

.bucket-chip--5to7 {
  background: color-mix(in srgb, #f97316 12%, transparent);
  color: #ea580c;
  border: 1px solid color-mix(in srgb, #f97316 35%, transparent);
}

.bucket-chip--7to9 {
  background: color-mix(in srgb, #0ea5e9 12%, transparent);
  color: #0284c7;
  border: 1px solid color-mix(in srgb, #0ea5e9 35%, transparent);
}

.bucket-chip--9plus {
  background: color-mix(in srgb, #10b981 12%, transparent);
  color: #059669;
  border: 1px solid color-mix(in srgb, #10b981 35%, transparent);
}

/* Chat bubbles */
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 4px;
}

.chat-msg {
  display: flex;
}

.chat-msg--agent {
  justify-content: flex-start;
}

.chat-msg--customer {
  justify-content: flex-end;
}

.chat-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-bubble--agent {
  background: var(--surface-soft, #f1f5f9);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}

.chat-bubble--customer {
  background: var(--brand, #6366f1);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-sender {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 2px;
  opacity: 0.7;
}

.chat-content {
  margin-bottom: 4px;
}

.chat-time {
  font-size: 10px;
  opacity: 0.5;
  text-align: right;
}

.drawer-transcript {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-soft, #f8f8f8);
  padding: 12px;
  border-radius: var(--radius-md, 6px);
  line-height: 1.6;
}

/* QA section */
.qa-section {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.qa-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.qa-section-title {
  font-size: 12px;
  font-weight: 800;
  text-transform: capitalize;
  color: var(--ink);
}

.qa-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  flex-wrap: wrap;
}

.qa-label {
  font-size: 12px;
  min-width: 140px;
  text-transform: capitalize;
  color: var(--ink);
}

.qa-rationale {
  font-size: 11px;
  color: var(--muted);
  flex: 1;
  min-width: 120px;
}

/* Objection Assessment */
.objection-cat-row {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: var(--surface-soft, #f8f8f8);
  border-radius: var(--radius-sm, 4px);
  border-left: 3px solid var(--border);
}

.objection-cat-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
  color: var(--ink);
  margin-bottom: 4px;
}

.objection-cat-flags {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.objection-cat-comment {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.checklist-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Campaign Q&A (e.g. Parity) rows */
.parity-subheader {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin: 12px 0 6px;
}

.parity-row {
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 8px;
  row-gap: 4px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.parity-row:last-child {
  border-bottom: none;
}

.parity-row--headline {
  background: rgba(2, 132, 199, 0.04);
  padding-left: 8px;
  padding-right: 8px;
  border-radius: 4px;
}

.parity-row-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}

.parity-detail {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--ink);
  line-height: 1.45;
}

.parity-quote {
  grid-column: 1 / -1;
  font-size: 11px;
  font-style: italic;
  color: var(--muted);
  line-height: 1.45;
}

.parity-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  max-width: 60%;
}

.parity-driver {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.parity-driver:last-child {
  border-bottom: none;
}

.parity-driver-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 2px;
}

/* Drawer transition */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}

.mono {
  font-family: ui-monospace, "Courier New", monospace;
}
</style>
