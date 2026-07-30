import {
  buildRawJson,
  buildSurveyAnswers,
  naturalKeyColumnLabel,
  resolveNaturalKeyColumn,
  stageRow,
} from './validate-row';
import { LIVEPERSON_MAPPING } from '../mappings/source-mappings';
import { SourceRow } from '../mappings/mapping.types';

const mapping = LIVEPERSON_MAPPING;

const TRANSCRIPT = [
  '09:15:02 - Consumer: my car has broken down',
  '09:15:30 - Agent: sorry to hear that, where are you?',
].join('\n');

/** A minimally valid LivePerson row. */
function makeRow(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    conversationId: 'conv-0001',
    brandId: 'brand-1',
    startTimeLOCAL: '19/02/2025 15:38:00',
    campaignName: 'RAC Breakdown New Business',
    latestAgentFullName: 'Jane Smith',
    closeReasonDescription: 'Resolved by agent',
    latestSkillName: 'RAC Breakdown',
    duration: '512',
    messageCount: '2',
    isPartial: 'false',
    isTruncated: 'false',
    csatRate: '',
    csatCount: '0',
    mcs: '60',
    alertedMCS: 'false',
    transcriptAll: TRANSCRIPT,
    ...overrides,
  };
}

function headersOf(row: SourceRow): string[] {
  return Object.keys(row);
}

function stage(row: SourceRow, naturalKeyColumn = 'conversationId') {
  return stageRow({
    row,
    headers: headersOf(row),
    rowNumber: 1,
    mapping,
    naturalKeyColumn,
  });
}

const codes = (r: ReturnType<typeof stage>) => r.issues.map((i) => i.code);

describe('resolveNaturalKeyColumn', () => {
  it('prefers conversationId', () => {
    const headers = ['conversationId', 'sessionId', 'interactionContextId'];
    expect(resolveNaturalKeyColumn(headers, mapping)).toBe('conversationId');
  });

  it('falls through to the next candidate when the column is absent', () => {
    expect(resolveNaturalKeyColumn(['sessionId', 'brandId'], mapping)).toBe(
      'sessionId',
    );
  });

  it('skips a present-but-empty candidate when sample rows are supplied', () => {
    const headers = ['conversationId', 'sessionId'];
    const rows = [{ conversationId: '', sessionId: 'sess-1' }];
    expect(resolveNaturalKeyColumn(headers, mapping, rows)).toBe('sessionId');
  });

  it('falls back to the positional first column', () => {
    // The safety net for a renamed or blank first header.
    expect(resolveNaturalKeyColumn(['someOddName', 'brandId'], mapping)).toBe('#1');
  });

  it('resolves a positional reference to its header name for display', () => {
    expect(naturalKeyColumnLabel('#1', ['weirdName', 'b'])).toBe('weirdName');
    expect(naturalKeyColumnLabel('conversationId', ['conversationId'])).toBe(
      'conversationId',
    );
  });
});

describe('stageRow — happy path', () => {
  it('projects a clean row with no issues', () => {
    const r = stage(makeRow());

    expect(r.validationStatus).toBe('valid');
    expect(r.issues).toEqual([]);
    expect(r.excluded).toBe(false);

    const p = r.projected;
    expect(p.interactionId).toBe('conv-0001');
    // interactionTpsId carries the same id: it is the CSAT match key, and
    // LivePerson has no separate reference id.
    expect(p.interactionTpsId).toBe('conv-0001');
    expect(p.campaign).toBe('RAC Breakdown New Business');
    expect(p.agent).toBe('Jane Smith');
    expect(p.outcome).toBe('Resolved by agent');
    expect(p.durationSeconds).toBe(512);
    expect(p.isPartial).toBe(false);
    expect(p.mcs).toBe(60);
    // dealer is deliberately unmapped for this RAC-level feed.
    expect(p.dealer).toBeNull();
  });

  it('reads the UK date format day-first', () => {
    const d = stage(makeRow()).projected.interactionDateTime!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2025, 2, 19]);
  });

  it('normalises the transcript into anchored JSON', () => {
    const r = stage(makeRow());
    expect(r.transcript.status).toBe('parsed');
    expect(r.transcript.includedCount).toBe(2);
    const payload = JSON.parse(r.transcript.transcriptJson!);
    expect(payload[0].timestamp).toBe('2025-02-19T09:15:02');
    expect(payload[0].source).toBe('Customer');
  });

  it('classifies a transcript that uses the agent real name', () => {
    const r = stage(
      makeRow({
        transcriptAll: [
          '09:15:02 - Consumer: hello',
          '09:15:30 - Jane Smith: hi there',
        ].join('\n'),
      }),
    );
    // latestAgentFullName is consulted, so this is not an Unknown speaker.
    expect(r.transcript.unknownSpeakerCount).toBe(0);
    expect(r.transcript.messages[1]!.source).toBe('Agent');
    expect(r.validationStatus).toBe('valid');
  });
});

describe('stageRow — errors', () => {
  it('E_NO_KEY when the conversation id is blank', () => {
    const r = stage(makeRow({ conversationId: '' }));
    expect(codes(r)).toContain('E_NO_KEY');
    expect(r.validationStatus).toBe('error');
    expect(r.excluded).toBe(true);
  });

  it('E_KEY_TOO_LONG rather than silently truncating an identifier', () => {
    const longId = 'x'.repeat(60);
    const r = stage(makeRow({ conversationId: longId }));

    expect(codes(r)).toContain('E_KEY_TOO_LONG');
    expect(r.validationStatus).toBe('error');
    // The full value is staged so the UI can show what arrived.
    expect(r.projected.interactionId).toBe(longId);
    expect(r.issues.find((i) => i.code === 'E_KEY_TOO_LONG')!.original).toBe(longId);
  });

  it('E_NO_DATE when no start time parses', () => {
    const r = stage(makeRow({ startTimeLOCAL: 'not a date' }));
    expect(codes(r)).toContain('E_NO_DATE');
    expect(r.validationStatus).toBe('error');
  });

  it('E_NO_TRANSCRIPT when there is no content at all', () => {
    const r = stage(makeRow({ transcriptAll: '' }));
    expect(codes(r)).toContain('E_NO_TRANSCRIPT');
  });

  it('E_TRANSCRIPT_UNPARSED when content exists but nothing matches', () => {
    const r = stage(makeRow({ transcriptAll: 'just prose, no timestamps' }));
    expect(codes(r)).toContain('E_TRANSCRIPT_UNPARSED');
    expect(codes(r)).not.toContain('E_NO_TRANSCRIPT');
  });
});

describe('stageRow — warnings', () => {
  it('W_TRUNC_campaign keeps the original value', () => {
    const long = 'RAC ' + 'Breakdown Cover Campaign '.repeat(6);
    const r = stage(makeRow({ campaignName: long }));

    const issue = r.issues.find((i) => i.code === 'W_TRUNC_campaign')!;
    expect(issue.level).toBe('warning');
    expect(issue.original).toBe(long.trim());
    expect(issue.truncatedTo).toBe(50);
    expect(r.projected.campaign!.length).toBe(50);
    expect(r.validationStatus).toBe('warning');
    expect(r.excluded).toBe(false);
  });

  it('W_VALUE_campaign when the campaign would not match /rac/i', () => {
    // The silent failure this guards: no "RAC" means the chat insights prompt
    // skips the RAC QA assessment entirely.
    const r = stage(makeRow({ campaignName: 'Generic Breakdown' }));
    const issue = r.issues.find((i) => i.code === 'W_VALUE_campaign')!;
    expect(issue).toBeDefined();
    expect(issue.message).toMatch(/RAC QA assessment/);
  });

  it('falls back to RAC when campaignName is blank', () => {
    const r = stage(makeRow({ campaignName: '' }));
    expect(r.projected.campaign).toBe('RAC');
    expect(codes(r)).not.toContain('W_NO_CAMPAIGN');
    expect(codes(r)).not.toContain('W_VALUE_campaign');
  });

  it('W_NO_AGENT when no agent column is populated', () => {
    const r = stage(makeRow({ latestAgentFullName: '' }));
    expect(codes(r)).toContain('W_NO_AGENT');
  });

  it('W_PARTIAL_CONVERSATION when the source flags truncation', () => {
    const r = stage(makeRow({ isTruncated: 'true' }));
    expect(codes(r)).toContain('W_PARTIAL_CONVERSATION');
    expect(r.projected.isTruncated).toBe(true);
  });

  it('W_UNKNOWN_SPEAKER and W_TRANSCRIPT_PARTIAL for an unrecognised label', () => {
    const r = stage(
      makeRow({
        transcriptAll: [
          '09:15:02 - Consumer: hello',
          '09:15:10 - Supervisor Bob: stepping in',
        ].join('\n'),
      }),
    );
    expect(codes(r)).toContain('W_UNKNOWN_SPEAKER');
    expect(codes(r)).toContain('W_TRANSCRIPT_PARTIAL');
    expect(r.validationStatus).toBe('warning');
  });

  it('W_COLUMN_COUNT when the record field count differs from the header', () => {
    const row = makeRow();
    const r = stageRow({
      row,
      headers: headersOf(row),
      rowNumber: 1,
      mapping,
      naturalKeyColumn: 'conversationId',
      fieldCount: headersOf(row).length + 1,
    });
    expect(codes(r)).toContain('W_COLUMN_COUNT');
  });
});

describe('stageRow — CSAT', () => {
  it('reads csatRate when csatCount is positive', () => {
    const r = stage(makeRow({ csatRate: '2', csatCount: '1' }));
    expect(r.projected.csatScore).toBe(2);
    expect(r.projected.csatScoreMax).toBe(5);
  });

  it('ignores csatRate when no survey was answered', () => {
    // LivePerson reports 0 for an unanswered survey; storing that as a score of
    // zero would invent the worst possible CSAT for most conversations.
    const r = stage(makeRow({ csatRate: '0', csatCount: '0' }));
    expect(r.projected.csatScore).toBeNull();
  });

  it('W_CSAT_NO_SCORE when a survey was answered but no rate came through', () => {
    const r = stage(makeRow({ csatRate: '', csatCount: '1' }));
    expect(codes(r)).toContain('W_CSAT_NO_SCORE');
    expect(r.projected.csatScore).toBeNull();
  });

  it('picks up a free-text comment from the post-survey answer', () => {
    const r = stage(
      makeRow({
        csatRate: '2',
        csatCount: '1',
        surveyAnswerPostSurvey: 'Waited far too long',
      }),
    );
    expect(r.projected.csatComment).toBe('Waited far too long');
  });

  it('takes only the FIRST answer from a multi-value comment column', () => {
    // The source column holds one answer per question, delimiter-separated.
    // Storing the cell verbatim glued the answers together and that string then
    // became interaction_csat.comment — read downstream as the customer verbatim.
    const r = stage(
      makeRow({
        csatRate: '2',
        csatCount: '1',
        surveyAnswerPostSurvey: 'Waited far too long for recovery;No;5',
      }),
    );
    expect(r.projected.csatComment).toBe('Waited far too long for recovery');
  });

  it('skips leading empty answers when choosing the comment', () => {
    const r = stage(
      makeRow({
        csatRate: '3',
        csatCount: '1',
        surveyAnswerPostSurvey: ';;Recovery took three hours',
      }),
    );
    expect(r.projected.csatComment).toBe('Recovery took three hours');
  });

  it('leaves the comment null when every answer is empty', () => {
    const r = stage(
      makeRow({ csatRate: '3', csatCount: '1', surveyAnswerPostSurvey: ';;' }),
    );
    expect(r.projected.csatComment).toBeNull();
  });

  it('keeps mcs separate from the CSAT score', () => {
    // mcs is LivePerson's own sentiment score, not a customer-stated rating.
    const r = stage(makeRow({ mcs: '35', csatRate: '', csatCount: '0' }));
    expect(r.projected.mcs).toBe(35);
    expect(r.projected.csatScore).toBeNull();
  });
});

describe('buildRawJson — PII policy', () => {
  it('drops consumer contact columns entirely', () => {
    const row = makeRow({
      consumerParticipantsEmail: 'someone@example.com',
      consumerParticipantsPhone: '07700900123',
      'personalInfo-name': 'Alex',
      ipAddress: '10.0.0.1',
    });
    const { rawJson, droppedColumns } = buildRawJson(row, headersOf(row), mapping);
    const parsed = JSON.parse(rawJson);

    expect(parsed.consumerParticipantsEmail).toBeUndefined();
    expect(parsed.consumerParticipantsPhone).toBeUndefined();
    expect(parsed['personalInfo-name']).toBeUndefined();
    expect(parsed.ipAddress).toBeUndefined();
    expect(rawJson).not.toContain('someone@example.com');
    expect(rawJson).not.toContain('07700900123');

    expect(droppedColumns).toEqual(
      expect.arrayContaining([
        'consumerParticipantsEmail',
        'consumerParticipantsPhone',
        'personalInfo-name',
        'ipAddress',
      ]),
    );
  });

  it('drops whole prefixed families via the glob pattern', () => {
    const row = makeRow({
      'customerInfo-customerId': 'cust-1',
      'customerInfo-userName': 'alex99',
      'unauthcustomerInfo-imei': '123456',
    });
    const { rawJson } = buildRawJson(row, headersOf(row), mapping);
    expect(rawJson).not.toContain('cust-1');
    expect(rawJson).not.toContain('alex99');
    expect(rawJson).not.toContain('123456');
  });

  it('keeps analytically useful columns', () => {
    const row = makeRow({ 'monitoring-country': 'United Kingdom' });
    const parsed = JSON.parse(buildRawJson(row, headersOf(row), mapping).rawJson);
    expect(parsed['monitoring-country']).toBe('United Kingdom');
    expect(parsed.campaignName).toBe('RAC Breakdown New Business');
    expect(parsed.latestAgentFullName).toBe('Jane Smith');
  });

  it('omits empty cells so a mostly-blank wide row stays compact', () => {
    const row = makeRow({ goalName: '', lobName: '' });
    const parsed = JSON.parse(buildRawJson(row, headersOf(row), mapping).rawJson);
    expect('goalName' in parsed).toBe(false);
    expect('lobName' in parsed).toBe(false);
  });
});

describe('buildSurveyAnswers', () => {
  it('zips parallel multi-value question and answer columns', () => {
    const row = makeRow({
      surveyQuestionPostSurvey: 'How satisfied were you?;Would you recommend us?',
      surveyAnswerPostSurvey: '2;No',
      surveyQuestionIdPostSurvey: 'q1;q2',
      surveyAnswerIdPostSurvey: 'a1;a2',
    });
    const answers = buildSurveyAnswers(row, headersOf(row), mapping);

    expect(answers).toHaveLength(2);
    expect(answers[0]).toEqual({
      block: 'post_chat',
      question: 'How satisfied were you?',
      answer: '2',
      questionId: 'q1',
      answerId: 'a1',
    });
    expect(answers[1]!.answer).toBe('No');
  });

  it('tolerates a question/answer length mismatch instead of dropping the block', () => {
    const row = makeRow({
      surveyQuestionPostSurvey: 'Q1;Q2;Q3',
      surveyAnswerPostSurvey: 'A1;A2',
    });
    const answers = buildSurveyAnswers(row, headersOf(row), mapping);
    expect(answers).toHaveLength(3);
    expect(answers[2]).toEqual({ block: 'post_chat', question: 'Q3', answer: '' });
  });

  it('collects the in-chat survey block as well as the post-chat one', () => {
    const row = makeRow({
      surveyQuestion: 'Pre-chat reason?',
      surveyAnswer: 'Breakdown',
      surveyQuestionPostSurvey: 'Satisfied?',
      surveyAnswerPostSurvey: '5',
    });
    const answers = buildSurveyAnswers(row, headersOf(row), mapping);
    expect(answers.map((a) => a.block)).toEqual(['post_chat', 'in_chat']);
  });

  it('returns nothing when no survey columns are populated', () => {
    expect(buildSurveyAnswers(makeRow(), headersOf(makeRow()), mapping)).toEqual([]);
  });
});

describe('stageRow is the invariant that makes re-keying reversible', () => {
  // Re-keying a staged run re-projects each row through stageRow rather than
  // patching columns in SQL. That is only safe because stageRow RECOMPUTES the
  // issue list every time. An earlier version appended E_NO_KEY to the stored
  // validationJson instead, which made re-keying a one-way door: pointing at a
  // blank column errored every row, and pointing back left the injected error
  // behind for ever.
  it('recomputes issues from scratch, never accumulating them', () => {
    const row = makeRow();
    const good = stage(row, 'conversationId');
    const bad = stage(row, 'sessionId'); // absent from this row
    const goodAgain = stage(row, 'conversationId');

    expect(good.validationStatus).toBe('valid');
    expect(codes(bad)).toContain('E_NO_KEY');
    expect(bad.validationStatus).toBe('error');

    // Round trip must be identical to the first pass, not merely similar.
    expect(goodAgain.validationStatus).toBe('valid');
    expect(goodAgain.issues).toEqual(good.issues);
    expect(goodAgain.projected.interactionId).toBe(good.projected.interactionId);
    expect(goodAgain.excluded).toBe(false);
  });

  it('is deterministic across repeated calls', () => {
    const row = makeRow({ campaignName: 'Generic Breakdown' });
    const first = stage(row);
    const second = stage(row);
    expect(second.issues).toEqual(first.issues);
    expect(second.validationStatus).toBe(first.validationStatus);
  });
});

describe('stageRow — positional key fallback', () => {
  it('reads the conversation id from column 1 by position', () => {
    // Covers a renamed or blank first header without needing a re-upload.
    const row: SourceRow = {
      someOddName: 'conv-9999',
      startTimeLOCAL: '19/02/2025 15:38:00',
      campaignName: 'RAC',
      latestAgentFullName: 'Jane Smith',
      transcriptAll: TRANSCRIPT,
    };
    const r = stageRow({
      row,
      headers: Object.keys(row),
      rowNumber: 1,
      mapping,
      naturalKeyColumn: '#1',
    });
    expect(r.projected.interactionId).toBe('conv-9999');
    expect(r.validationStatus).toBe('valid');
  });
});
