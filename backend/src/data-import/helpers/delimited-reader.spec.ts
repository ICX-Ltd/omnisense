// End-to-end exercise of the real streaming reader over a synthetic LivePerson
// export: sniff -> csv-parse -> project -> validate. No database involved.

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { iterateRows, planRead, expectedColumnCount } from './delimited-reader';
import { stageRow, resolveNaturalKeyColumn, StagedRow } from './validate-row';
import { LIVEPERSON_MAPPING } from '../mappings/source-mappings';
import { parseChatTranscript } from '../../insights/chat-response-time';
import {
  FIXTURE_ROWS,
  LIVEPERSON_HEADERS,
  renderFixture,
  renderFixtureUtf16le,
  renderFixtureUtf8Bom,
} from '../__fixtures__/liveperson-fixture';

const mapping = LIVEPERSON_MAPPING;

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aii-import-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeFixture(
  name: string,
  content: string | Buffer,
): Promise<string> {
  const full = path.join(tmpDir, name);
  await fs.writeFile(full, content);
  return full;
}

/** Runs the whole pipeline and returns staged rows keyed by conversation id. */
async function stageAll(filePath: string): Promise<{
  rows: StagedRow[];
  headers: string[];
  naturalKeyColumn: string | null;
  skipped: { rowNumber: number | null; message: string }[];
}> {
  const plan = await planRead(filePath, mapping);
  const skipped: { rowNumber: number | null; message: string }[] = [];

  // Two passes only because natural-key resolution wants sample rows; the
  // staging service resolves the key once and streams a single pass.
  const sample: Record<string, string>[] = [];
  for await (const r of iterateRows(plan, { limit: 5 })) sample.push(r.row);
  const naturalKeyColumn = resolveNaturalKeyColumn(plan.headers, mapping, sample);

  const rows: StagedRow[] = [];
  for await (const { row, rowNumber, fieldCount } of iterateRows(plan, {
    onSkip: (s) => skipped.push(s),
  })) {
    rows.push(
      stageRow({ row, headers: plan.headers, rowNumber, mapping, naturalKeyColumn }),
    );
    void fieldCount;
  }

  return { rows, headers: plan.headers, naturalKeyColumn, skipped };
}

function byId(rows: StagedRow[], id: string): StagedRow {
  const hit = rows.find((r) => r.projected.srcConversationId === id);
  if (!hit) throw new Error(`no staged row for ${id}`);
  return hit;
}

const codes = (r: StagedRow) => r.issues.map((i) => i.code);

describe('planRead', () => {
  it('sniffs a tab-separated file that is named .csv', async () => {
    // The real LivePerson case.
    const file = await writeFixture('export.csv', renderFixture());
    const plan = await planRead(file, mapping);

    expect(plan.delimiter).toBe('\t');
    expect(plan.encoding).toBe('utf8');
    expect(plan.headers).toEqual(LIVEPERSON_HEADERS);
    expect(plan.headerColumnCount).toBe(LIVEPERSON_HEADERS.length);
  });

  it('reads a header of roughly the real export width', () => {
    // Guards against the fixture silently shrinking.
    expect(LIVEPERSON_HEADERS.length).toBeGreaterThan(300);
    expect(LIVEPERSON_HEADERS[0]).toBe('conversationId');
    expect(LIVEPERSON_HEADERS.at(-1)).toBe('transcriptConsumer');
  });

  it('handles UTF-16LE with a BOM, as Excel saves it', async () => {
    const file = await writeFixture('export-utf16.csv', renderFixtureUtf16le());
    const plan = await planRead(file, mapping);

    expect(plan.encoding).toBe('utf16le');
    expect(plan.bomLength).toBe(2);
    // Without BOM handling the first header arrives NUL-padded and matches nothing.
    expect(plan.headers[0]).toBe('conversationId');
    expect(plan.headers).toEqual(LIVEPERSON_HEADERS);
  });

  it('handles UTF-8 with a BOM', async () => {
    const file = await writeFixture('export-utf8bom.csv', renderFixtureUtf8Bom());
    const plan = await planRead(file, mapping);
    expect(plan.encoding).toBe('utf8bom');
    expect(plan.headers[0]).toBe('conversationId');
  });

  it('parses a comma-delimited variant of the same data', async () => {
    const file = await writeFixture('export-comma.csv', renderFixture({ delimiter: ',' }));
    const plan = await planRead(file, mapping);
    expect(plan.delimiter).toBe(',');
    expect(plan.headers).toEqual(LIVEPERSON_HEADERS);
  });

  it('rejects an empty file with a readable message', async () => {
    const file = await writeFixture('empty.csv', '');
    await expect(planRead(file, mapping)).rejects.toThrow(/empty/i);
  });

  it('rejects a file that is clearly not this export', async () => {
    const file = await writeFixture('wrong.csv', 'name,age\nalex,30\n');
    await expect(planRead(file, mapping)).rejects.toThrow(/expects around/);
  });

  it('derives a non-trivial expected column count from the mapping', () => {
    expect(expectedColumnCount(mapping)).toBeGreaterThan(10);
  });
});

describe('iterateRows', () => {
  it('yields every data row, header excluded', async () => {
    const file = await writeFixture('rows.csv', renderFixture());
    const seen: number[] = [];
    const plan = await planRead(file, mapping);
    for await (const r of iterateRows(plan)) seen.push(r.rowNumber);

    expect(seen).toHaveLength(FIXTURE_ROWS.length);
    expect(seen[0]).toBe(1);
  });

  it('honours a row limit, which is what preview uses', async () => {
    const file = await writeFixture('limit.csv', renderFixture());
    const plan = await planRead(file, mapping);
    const rows: Array<{ rowNumber: number }> = [];
    for await (const r of iterateRows(plan, { limit: 3 })) rows.push(r);
    expect(rows).toHaveLength(3);
  });

  it('keeps a quoted transcript intact across embedded delimiters and newlines', async () => {
    const file = await writeFixture('quoted.csv', renderFixture());
    const { rows } = await stageAll(file);
    const r = byId(rows, 'conv-0002');

    // Commas, a tab, doubled quotes and CRLF line breaks all inside one field.
    expect(r.projected.transcriptRaw).toContain('which is a 2019 Golf');
    expect(r.projected.transcriptRaw).toContain('\t');
    expect(r.projected.transcriptRaw).toContain('"it is the battery"');
    expect(r.transcript.messages).toHaveLength(4);
    expect(r.validationStatus).toBe('valid');
  });

  it('reports a ragged row rather than misaligning it silently', async () => {
    const file = await writeFixture(
      'ragged.csv',
      renderFixture({ includeRaggedRow: true }),
    );
    const plan = await planRead(file, mapping);
    let ragged: { fieldCount: number; headerCount: number } | null = null;
    for await (const r of iterateRows(plan)) {
      if (r.fieldCount !== plan.headers.length) {
        ragged = { fieldCount: r.fieldCount, headerCount: plan.headers.length };
      }
    }
    expect(ragged).not.toBeNull();
    expect(ragged!.fieldCount).toBe(ragged!.headerCount + 1);
  });
});

describe('staging the fixture end to end', () => {
  let staged: Awaited<ReturnType<typeof stageAll>>;

  beforeAll(async () => {
    const file = await writeFixture('full.csv', renderFixture());
    staged = await stageAll(file);
  });

  it('resolves conversationId as the natural key', () => {
    expect(staged.naturalKeyColumn).toBe('conversationId');
  });

  it('skips no records', () => {
    expect(staged.skipped).toEqual([]);
  });

  it('stages the clean baseline row as valid', () => {
    const r = staged.rows[0]!;
    expect(r.projected.srcConversationId).toBe('conv-0001');
    expect(r.validationStatus).toBe('valid');
    expect(r.issues).toEqual([]);
    expect(r.projected.agent).toBe('Jane Smith');
    expect(r.projected.campaign).toBe('RAC Breakdown New Business');
    expect(r.projected.outcome).toBe('Resolved by agent');
    expect(r.transcript.includedCount).toBe(4);
  });

  it('anchors transcript timestamps on the conversation start date', () => {
    const payload = JSON.parse(staged.rows[0]!.transcript.transcriptJson!);
    expect(payload[0].timestamp).toBe('2025-02-19T09:15:02');
    expect(payload[3].timestamp).toBe('2025-02-19T09:16:45');
  });

  describe('midnight and multi-day conversations', () => {
    it('rolls the date forward and keeps response gaps positive', () => {
      const r = byId(staged.rows, 'conv-0003');
      expect(r.transcript.maxDayOffset).toBe(1);

      const payload = JSON.parse(r.transcript.transcriptJson!);
      expect(payload[1].timestamp).toBe('2025-02-19T23:59:30');
      expect(payload[2].timestamp).toBe('2025-02-20T00:01:15');

      // The reason for emitting JSON rather than the HH:MM line format.
      const reparsed = parseChatTranscript(r.transcript.transcriptJson!);
      const gaps = reparsed
        .slice(1)
        .map((m, i) => m.totalSeconds - reparsed[i]!.totalSeconds);
      expect(gaps.every((g) => g > 0)).toBe(true);
    });

    it('handles two rollovers in one conversation', () => {
      const r = byId(staged.rows, 'conv-0004');
      expect(r.transcript.messages.map((m) => m.dayOffset)).toEqual([0, 1, 1, 2]);
    });
  });

  it('reads an Excel serial start time', () => {
    const r = byId(staged.rows, 'conv-0005');
    const d = r.projected.interactionDateTime!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2025, 2, 19]);
    expect(codes(r)).not.toContain('E_NO_DATE');
  });

  it('truncates an over-length campaign and keeps the original', () => {
    const r = byId(staged.rows, 'conv-0006');
    const issue = r.issues.find((i) => i.code === 'W_TRUNC_campaign')!;
    expect(issue).toBeDefined();
    expect(r.projected.campaign!.length).toBe(50);
    expect(issue.original!.length).toBeGreaterThan(50);
    expect(r.validationStatus).toBe('warning');
    expect(r.excluded).toBe(false);
  });

  it('merges the side transcript columns when transcriptAll is empty', () => {
    const r = byId(staged.rows, 'conv-0007');
    expect(r.transcript.messages).toHaveLength(4);
    expect(r.transcript.messages.map((m) => m.source)).toEqual([
      'Customer',
      'Agent',
      'Customer',
      'Agent',
    ]);
    expect(codes(r)).not.toContain('E_NO_TRANSCRIPT');
  });

  it('extracts CSAT, its comment and the survey answers', () => {
    const r = byId(staged.rows, 'conv-0008');
    expect(r.projected.csatScore).toBe(2);
    expect(r.projected.csatScoreMax).toBe(5);
    expect(r.projected.csatComment).toContain('Waited far too long');
    expect(r.projected.mcs).toBe(25);
    expect(r.projected.alertedMcs).toBe(true);

    expect(r.surveyAnswers).toHaveLength(2);
    expect(r.surveyAnswers[0]).toMatchObject({
      block: 'post_chat',
      question: 'How satisfied were you?',
      answer: 'Waited far too long for recovery',
      questionId: 'q1',
    });
  });

  it('leaves csatScore null when no survey was answered', () => {
    // csatRate is blank and csatCount is 0 on the baseline row.
    expect(staged.rows[0]!.projected.csatScore).toBeNull();
  });

  it('classifies an agent-real-name speaker label as Agent', () => {
    const r = byId(staged.rows, 'conv-0009');
    expect(r.transcript.unknownSpeakerCount).toBe(0);
    expect(r.transcript.messages[1]!.source).toBe('Agent');
    expect(r.validationStatus).toBe('valid');
  });

  it('keeps System and Bot messages and flags the handover', () => {
    const r = byId(staged.rows, 'conv-0010');
    expect(r.transcript.messages.map((m) => m.source)).toEqual([
      'System',
      'Bot',
      'Customer',
      'Agent',
      'Agent',
    ]);
    expect(r.transcript.messages.filter((m) => m.isHandover)).toHaveLength(1);
    expect(r.transcript.includedCount).toBe(5);
  });

  it('stages an unknown speaker but excludes it from the transcript', () => {
    const r = byId(staged.rows, 'conv-0011');
    expect(codes(r)).toContain('W_UNKNOWN_SPEAKER');
    expect(r.transcript.messages).toHaveLength(3);
    expect(r.transcript.includedCount).toBe(2);
    expect(r.transcript.messages[1]!.includedInTranscript).toBe(false);
  });

  describe('rows that must not be promoted', () => {
    it('flags an over-long conversation id as an error', () => {
      const r = staged.rows.find((x) => codes(x).includes('E_KEY_TOO_LONG'))!;
      expect(r).toBeDefined();
      expect(r.validationStatus).toBe('error');
      expect(r.excluded).toBe(true);
    });

    it('flags a blank conversation id', () => {
      const r = staged.rows.find((x) => codes(x).includes('E_NO_KEY'))!;
      expect(r.validationStatus).toBe('error');
      expect(r.excluded).toBe(true);
    });

    it('flags an unparseable date', () => {
      const r = byId(staged.rows, 'conv-0012');
      expect(codes(r)).toContain('E_NO_DATE');
      expect(r.excluded).toBe(true);
    });

    it('flags a missing transcript', () => {
      const r = byId(staged.rows, 'conv-0013');
      expect(codes(r)).toContain('E_NO_TRANSCRIPT');
      expect(r.excluded).toBe(true);
    });

    it('flags a transcript that parsed to nothing', () => {
      const r = byId(staged.rows, 'conv-0014');
      expect(codes(r)).toContain('E_TRANSCRIPT_UNPARSED');
      expect(r.excluded).toBe(true);
    });
  });

  it('warns on a partial or truncated conversation', () => {
    const r = byId(staged.rows, 'conv-0015');
    expect(codes(r)).toContain('W_PARTIAL_CONVERSATION');
    expect(r.excluded).toBe(false);
  });

  it('warns when the campaign would not trigger the RAC QA assessment', () => {
    const r = byId(staged.rows, 'conv-0016');
    expect(codes(r)).toContain('W_VALUE_campaign');
    expect(r.projected.campaign).toBe('Generic Breakdown Enquiry');
  });

  it('warns on a missing agent and an unscored answered survey', () => {
    const r = byId(staged.rows, 'conv-0017');
    expect(codes(r)).toContain('W_NO_AGENT');
    expect(codes(r)).toContain('W_CSAT_NO_SCORE');
  });

  it('detects the in-file duplicate as two rows sharing an id', () => {
    // Flagging is a set-based pass over the staged run; staging itself must keep
    // both rows visible rather than rejecting one mid-parse.
    const dupes = staged.rows.filter(
      (r) => r.projected.srcConversationId === 'conv-0001',
    );
    expect(dupes).toHaveLength(2);
    expect(dupes[0]!.rowNumber).toBeLessThan(dupes[1]!.rowNumber);
  });

  describe('PII policy', () => {
    it('drops every consumer contact field before rawJson is built', () => {
      const r = byId(staged.rows, 'conv-0018');

      expect(r.rawJson).not.toContain('alex.jones@example.com');
      expect(r.rawJson).not.toContain('07700900123');
      expect(r.rawJson).not.toContain('Alex');
      expect(r.rawJson).not.toContain('Jones');
      expect(r.rawJson).not.toContain('CUST-556677');
      expect(r.rawJson).not.toContain('alexj99');
      expect(r.rawJson).not.toContain('490154203237518');
      expect(r.rawJson).not.toContain('203.0.113.42');

      expect(r.droppedColumns).toEqual(
        expect.arrayContaining([
          'consumerParticipantsEmail',
          'consumerParticipantsPhone',
          'personalInfo-email',
          'customerInfo-customerId',
          'unauthcustomerInfo-imei',
          'ipAddress',
          'monitoring-ipAddress',
        ]),
      );
    });

    it('keeps the analytically useful columns', () => {
      const parsed = JSON.parse(byId(staged.rows, 'conv-0018').rawJson);
      expect(parsed.campaignName).toBe('RAC Breakdown New Business');
      expect(parsed.latestAgentFullName).toBe('Jane Smith');
      expect(parsed['monitoring-country']).toBe('United Kingdom');
      expect(parsed['monitoring-city']).toBe('Bristol');
    });

    it('keeps rawJson compact by omitting the mostly-blank columns', () => {
      // A ~330-column export is largely empty; storing every "" would bloat it.
      const parsed = JSON.parse(staged.rows[0]!.rawJson);
      expect(Object.keys(parsed).length).toBeLessThan(
        LIVEPERSON_HEADERS.length / 2,
      );
    });
  });

  it('every fixture row is accounted for', () => {
    expect(staged.rows).toHaveLength(FIXTURE_ROWS.length);
    const statuses = staged.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.validationStatus] = (acc[r.validationStatus] ?? 0) + 1;
      return acc;
    }, {});
    // Errors are the five deliberately-broken rows.
    expect(statuses.error).toBe(5);
    expect(statuses.valid! + statuses.warning!).toBe(FIXTURE_ROWS.length - 5);
  });
});

describe('UTF-16LE fixture stages identically to UTF-8', () => {
  it('produces the same conversation ids and statuses', async () => {
    const utf8 = await stageAll(await writeFixture('cmp-utf8.csv', renderFixture()));
    const utf16 = await stageAll(
      await writeFixture('cmp-utf16.csv', renderFixtureUtf16le()),
    );

    expect(utf16.rows.map((r) => r.projected.srcConversationId)).toEqual(
      utf8.rows.map((r) => r.projected.srcConversationId),
    );
    expect(utf16.rows.map((r) => r.validationStatus)).toEqual(
      utf8.rows.map((r) => r.validationStatus),
    );
  });
});
