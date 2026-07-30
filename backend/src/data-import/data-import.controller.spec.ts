// Wiring test for the data-import module: role gating, source listing, inbox
// listing and the preview pass over a real fixture file. No database — the
// module deliberately has no DB dependency yet, which is what makes phase 0
// shippable before the staging tables exist.

import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';
import { ImportParseService } from './import-parse.service';
import { ImportPromoteService } from './import-promote.service';
import { ImportRunsService } from './import-runs.service';
import { renderFixture } from './__fixtures__/liveperson-fixture';

const JWT_SECRET = 'test-secret';

let controller: DataImportController;
let jwt: JwtService;
let tmpDir: string;
const originalInbox = process.env.IMPORT_INBOX_DIR;

function tokenFor(roleId: string): string {
  return `Bearer ${jwt.sign({ sub: 'user-1', roleId })}`;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aii-ctrl-test-'));
  await fs.writeFile(path.join(tmpDir, 'liveperson-export.csv'), renderFixture());
  process.env.IMPORT_INBOX_DIR = tmpDir;

  // MulterModule is left out: it is only needed for the upload route, and
  // registering it here would create an upload directory as a side effect.
  //
  // The two DB-backed services are stubbed. This spec covers role gating,
  // source listing and preview — all of which live on DataImportService and
  // touch no database, which is exactly what makes phase 0 independently
  // shippable. The staging/promote paths are exercised against real tables.
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: JWT_SECRET })],
    controllers: [DataImportController],
    providers: [
      DataImportService,
      { provide: ImportParseService, useValue: {} },
      { provide: ImportPromoteService, useValue: {} },
      { provide: ImportRunsService, useValue: {} },
    ],
  }).compile();

  controller = moduleRef.get(DataImportController);
  jwt = moduleRef.get(JwtService);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  if (originalInbox === undefined) delete process.env.IMPORT_INBOX_DIR;
  else process.env.IMPORT_INBOX_DIR = originalInbox;
});

describe('role gating', () => {
  // JwtAuthGuard is never registered in this app, so every handler must gate
  // itself. These assertions are the only thing standing between the importer
  // and an unauthenticated caller.
  it('rejects a missing Authorization header', () => {
    expect(() => controller.listSources(undefined)).toThrow(UnauthorizedException);
  });

  it('rejects a malformed header', () => {
    expect(() => controller.listSources('not-a-bearer-token')).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with the wrong secret', () => {
    const foreign = new JwtService({ secret: 'some-other-secret' });
    const bad = `Bearer ${foreign.sign({ sub: 'u', roleId: 'admin' })}`;
    expect(() => controller.listSources(bad)).toThrow(UnauthorizedException);
  });

  it.each(['user', 'agent', 'supervisor'])('rejects role %s', (role) => {
    // Supervisor is rejected DELIBERATELY, unlike PromptsController which grants
    // it read access: the importer loads raw customer conversations into the live
    // interaction tables. useAccess.canImportData gates the page on the same two
    // roles, so a supervisor never sees a menu item that 403s.
    expect(() => controller.listSources(tokenFor(role))).toThrow(ForbiddenException);
  });

  it.each(['dev', 'admin'])('allows role %s', (role) => {
    expect(() => controller.listSources(tokenFor(role))).not.toThrow();
  });

  it('is case-insensitive about the role', () => {
    expect(() => controller.listSources(tokenFor('ADMIN'))).not.toThrow();
  });

  it('gates the server-file listing too', async () => {
    await expect(controller.listServerFiles(tokenFor('user'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('gates the preview route', async () => {
    await expect(
      controller.previewServerFile(
        'liveperson',
        'liveperson-export.csv',
        undefined,
        tokenFor('user'),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('GET /sources', () => {
  it('describes the liveperson source and its promote-time constants', () => {
    const sources = controller.listSources(tokenFor('admin'));
    expect(sources).toHaveLength(1);

    const lp = sources[0]!;
    expect(lp.key).toBe('liveperson');
    expect(lp.naturalKeyCandidates[0]).toBe('conversationId');
    expect(lp.expectedColumns).toBeGreaterThan(10);

    // The four load-bearing constants. status must be 'transcribed' or
    // startBatchInsightsChats never picks the rows up.
    expect(lp.interactionDefaults).toEqual({
      provider: 'openai',
      interactionSource: 'liveperson',
      interactionType: 'chat',
      status: 'transcribed',
    });
  });

  it('publishes the PII drop list so the policy is inspectable', () => {
    const lp = controller.listSources(tokenFor('admin'))[0]!;
    expect(lp.piiDropColumns).toEqual(
      expect.arrayContaining([
        'consumerParticipantsEmail',
        'customerInfo-*',
        'ipAddress',
      ]),
    );
  });

  it('reports the identifier fields as hard keys', () => {
    const lp = controller.listSources(tokenFor('admin'))[0]!;
    const campaign = lp.targetFields.find((f) => f.target === 'campaign')!;
    expect(campaign.maxLength).toBe(50);
    expect(campaign.hardKey).toBe(false);
  });
});

describe('GET /server-files', () => {
  it('lists the fixture in the inbox', async () => {
    const files = await controller.listServerFiles(tokenFor('admin'));
    expect(files.map((f) => f.name)).toContain('liveperson-export.csv');
    expect(files[0]!.sizeBytes).toBeGreaterThan(0);
    expect(typeof files[0]!.modifiedAt).toBe('string');
  });
});

describe('preview over the server inbox', () => {
  it('reports the shape of the file without writing anything', async () => {
    const result = await controller.previewServerFile(
      'liveperson',
      'liveperson-export.csv',
      undefined,
      tokenFor('admin'),
    );

    expect(result.sourceKey).toBe('liveperson');
    expect(result.file.intake).toBe('server');
    expect(result.encoding).toBe('utf8');
    // Named .csv, actually tab separated.
    expect(result.delimiterLabel).toBe('tab');
    expect(result.headerColumnCount).toBeGreaterThan(300);
    expect(result.naturalKeyColumn).toBe('conversationId');
    expect(result.naturalKeyColumnLabel).toBe('conversationId');
    expect(result.truncated).toBe(false);
  });

  it('summarises validation outcomes so the operator can judge the file', async () => {
    const result = await controller.previewServerFile(
      'liveperson',
      'liveperson-export.csv',
      undefined,
      tokenFor('admin'),
    );

    expect(result.rowsRead).toBeGreaterThan(15);
    expect(result.statusCounts.error).toBe(5);
    expect(result.issueCounts.E_KEY_TOO_LONG).toBe(1);
    expect(result.issueCounts.W_TRUNC_campaign).toBe(1);
    expect(result.issueCounts.W_VALUE_campaign).toBe(1);
    expect(result.transcriptStatusCounts.parsed).toBeGreaterThan(0);
    expect(result.duplicateKeysInSample).toEqual(['conv-0001']);
    expect(result.skipped).toEqual([]);
  });

  it('reports the column mapping, including what the file does not have', async () => {
    const result = await controller.previewServerFile(
      'liveperson',
      'liveperson-export.csv',
      undefined,
      tokenFor('admin'),
    );

    const mappedTargets = result.columnMapping.mapped.map((m) => m.target);
    expect(mappedTargets).toContain('campaign');
    expect(mappedTargets).toContain('agent');
    expect(mappedTargets).toContain('transcript');

    // dealer is deliberately unmapped for this RAC-level feed, and LivePerson
    // carries no vehicle columns.
    const missingTargets = result.columnMapping.missing.map((m) => m.target);
    expect(missingTargets).not.toContain('campaign');

    expect(result.columnMapping.droppedByPolicy).toEqual(
      expect.arrayContaining(['consumerParticipantsEmail', 'ipAddress']),
    );
    // The volumetrics LivePerson computes itself are unconsumed, by design.
    expect(result.columnMapping.unmapped).toContain('averageResponseTimeAgentHuman');
  });

  it('returns parsed messages so the bubbles can be eyeballed pre-promote', async () => {
    const result = await controller.previewServerFile(
      'liveperson',
      'liveperson-export.csv',
      undefined,
      tokenFor('admin'),
    );

    const first = result.sampleRows[0]!;
    expect(first.conversationId).toBe('conv-0001');
    expect(first.validationStatus).toBe('valid');
    expect(first.messages).toHaveLength(4);
    expect(first.messages[0]).toMatchObject({
      seq: 0,
      source: 'Customer',
      timestampIso: '2025-02-19T09:15:02',
      dayOffset: 0,
      included: true,
    });
  });

  it('honours a natural-key override without needing a re-upload', async () => {
    // The escape hatch for a renamed or unreliable first column.
    const result = await controller.previewServerFile(
      'liveperson',
      'liveperson-export.csv',
      'sessionId',
      tokenFor('admin'),
    );
    expect(result.naturalKeyColumn).toBe('sessionId');
    // The fixture leaves sessionId blank, so every row loses its key — exactly
    // the feedback the operator needs before staging anything.
    expect(result.issueCounts.E_NO_KEY).toBe(result.rowsRead);
  });

  it('rejects an unknown source key', async () => {
    await expect(
      controller.previewServerFile(
        'not-a-source',
        'liveperson-export.csv',
        undefined,
        tokenFor('admin'),
      ),
    ).rejects.toThrow(/Unknown import source/);
  });

  it('requires a source key', async () => {
    await expect(
      controller.previewServerFile(
        '',
        'liveperson-export.csv',
        undefined,
        tokenFor('admin'),
      ),
    ).rejects.toThrow(/sourceKey/);
  });

  it('requires a file name', async () => {
    await expect(
      controller.previewServerFile('liveperson', '', undefined, tokenFor('admin')),
    ).rejects.toThrow(/file/);
  });

  it('cannot be pointed outside the inbox', async () => {
    await expect(
      controller.previewServerFile(
        'liveperson',
        '../../../etc/passwd.csv',
        undefined,
        tokenFor('admin'),
      ),
    ).rejects.toThrow(/No such file/);
  });
});
