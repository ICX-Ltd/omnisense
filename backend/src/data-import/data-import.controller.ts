import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DataImportService } from './data-import.service';
import { ImportParseService } from './import-parse.service';
import { ImportPromoteService } from './import-promote.service';
import { ImportRunsService } from './import-runs.service';
import { ClientsService } from '../clients/clients.service';
import { assertAllowedExtension, deleteQuietly } from './helpers/file-source';
import {
  lazyImportDiskStorage,
  maxUploadBytes,
} from './helpers/upload-storage';
import {
  ExcludeRowDto,
  ExcludeStatusDto,
  RekeyDto,
  RollbackDto,
} from './dto/data-import.dto';

/**
 * Multer options for the two upload routes.
 *
 * Storage resolves its destination per request, so it does not matter that this
 * runs at decorator time — before .env is loaded. `limits` is the one value read
 * eagerly, and it has a sane default, so an unset IMPORT_MAX_UPLOAD_BYTES costs
 * nothing.
 */
const UPLOAD_OPTIONS = {
  storage: lazyImportDiskStorage(),
  limits: { fileSize: maxUploadBytes(), files: 1 },
};

// Roles are checked per handler: JwtAuthGuard exists in this codebase but is
// never registered, so there is no ambient protection to rely on.
//
// Deliberately dev/admin only — NOT the wider READ_ROLES that PromptsController
// grants supervisors. The importer loads raw customer conversations destined for
// the live interaction tables, so it stays a dev/admin tool. The frontend gates
// the page on the same two roles (useAccess.canImportData) rather than on
// canSeeAdminTools, so a supervisor is never shown a page that 403s.
const READ_ROLES = ['dev', 'admin'];
const WRITE_ROLES = ['dev', 'admin'];
// Rollback deletes promoted interactions and cascades away any insights derived
// from them — real LLM spend. Narrower than everything else on purpose.
const DANGER_ROLES = ['dev'];

@Controller('uiapi/data-import')
export class DataImportController {
  constructor(
    private readonly svc: DataImportService,
    private readonly parseSvc: ImportParseService,
    private readonly promoteSvc: ImportPromoteService,
    private readonly runsSvc: ImportRunsService,
    private readonly clientsSvc: ClientsService,
  ) {}

  // ─── sources & intake discovery ───────────────────────────────────────────

  /** The configured import sources and their mappings. */
  @Get('sources')
  listSources(@Headers('authorization') auth?: string) {
    this.svc.requireRole(auth, READ_ROLES);
    return this.svc.listSources();
  }

  /** Files waiting in the server-side import inbox. */
  @Get('server-files')
  async listServerFiles(@Headers('authorization') auth?: string) {
    this.svc.requireRole(auth, WRITE_ROLES);
    const files = await this.svc.listServerFiles();
    return files.map((f) => ({
      name: f.name,
      sizeBytes: f.sizeBytes,
      modifiedAt: f.modifiedAt.toISOString(),
    }));
  }

  // ─── preview (writes nothing) ─────────────────────────────────────────────

  /**
   * Dry-run parse of an uploaded file. Writes nothing.
   *
   * Metadata travels as query params rather than extra multipart fields: the
   * global ValidationPipe runs with forbidNonWhitelisted, which would reject
   * undeclared form fields with a 400.
   */
  @Post('runs/preview')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async previewUpload(
    @Query('sourceKey') sourceKey: string,
    @Query('naturalKeyColumn') naturalKeyColumn?: string,
    @UploadedFile() file?: Express.Multer.File,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    const upload = requireDiskUpload(file);
    try {
      return await this.svc.preview({
        filePath: upload.path,
        displayName: upload.originalname,
        intake: 'upload',
        sourceKey: requireSourceKey(sourceKey),
        naturalKeyColumnOverride: naturalKeyColumn || undefined,
      });
    } finally {
      // A preview keeps nothing, so the temp upload goes now rather than
      // accumulating in the upload directory.
      await deleteQuietly(upload.path);
    }
  }

  /** Dry-run parse of a file already sitting in the server inbox. */
  @Get('runs/preview-server')
  async previewServerFile(
    @Query('sourceKey') sourceKey: string,
    @Query('file') fileName: string,
    @Query('naturalKeyColumn') naturalKeyColumn?: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    if (!fileName) throw new BadRequestException('Missing "file" query parameter');
    const filePath = await this.svc.resolveServerFile(fileName);
    return this.svc.preview({
      filePath,
      displayName: fileName,
      intake: 'server',
      sourceKey: requireSourceKey(sourceKey),
      naturalKeyColumnOverride: naturalKeyColumn || undefined,
    });
  }

  // ─── staging ──────────────────────────────────────────────────────────────

  /** Stages an uploaded file. Returns as soon as the background parse starts. */
  @Post('runs/upload')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async stageUpload(
    @Query('sourceKey') sourceKey: string,
    @Query('clientId') clientId: string,
    @Query('naturalKeyColumn') naturalKeyColumn?: string,
    @UploadedFile() file?: Express.Multer.File,
    @Headers('authorization') auth?: string,
  ) {
    const { roleId } = this.svc.requireRole(auth, WRITE_ROLES);
    const upload = requireDiskUpload(file);
    const key = requireSourceKey(sourceKey);
    const mapping = this.svc.requireMapping(key);

    // The uploaded temp file is NOT deleted here: the background parse reads it
    // after this request returns. It is removed once the parse finishes.
    return this.parseSvc.startParse({
      sourceKey: key,
      mapping,
      filePath: upload.path,
      displayName: upload.originalname,
      intake: 'upload',
      naturalKeyColumnOverride: naturalKeyColumn || undefined,
      createdBy: roleId,
      clientId: requireClientId(clientId),
      deleteFileWhenDone: true,
    });
  }

  /**
   * Stages a file from the server inbox. This is the intended path for the real
   * monthly export; browser upload is for samples.
   */
  @Post('runs/server')
  async stageServerFile(
    @Query('sourceKey') sourceKey: string,
    @Query('file') fileName: string,
    @Query('clientId') clientId: string,
    @Query('naturalKeyColumn') naturalKeyColumn?: string,
    @Headers('authorization') auth?: string,
  ) {
    const { roleId } = this.svc.requireRole(auth, WRITE_ROLES);
    if (!fileName) throw new BadRequestException('Missing "file" query parameter');
    const key = requireSourceKey(sourceKey);
    const mapping = this.svc.requireMapping(key);
    const filePath = await this.svc.resolveServerFile(fileName);

    return this.parseSvc.startParse({
      sourceKey: key,
      mapping,
      filePath,
      displayName: fileName,
      intake: 'server',
      serverPath: filePath,
      naturalKeyColumnOverride: naturalKeyColumn || undefined,
      createdBy: roleId,
      clientId: requireClientId(clientId),
      // The inbox file is the operator's; never delete it.
      deleteFileWhenDone: false,
    });
  }

  /**
   * Stages a SQL-source pull (e.g. ICX call-centre calls/survey) for a date
   * range — no file involved. The Client selector's `clientKey` (not the raw
   * clientId) is what the source's query template keys its campaign lookup
   * on, so it's resolved here rather than passed straight through.
   */
  @Post('runs/sql')
  async stageSql(
    @Query('sourceKey') sourceKey: string,
    @Query('clientId') clientId: string,
    @Query('from') fromRaw: string,
    @Query('to') toRaw: string,
    @Headers('authorization') auth?: string,
  ) {
    const { roleId } = this.svc.requireRole(auth, WRITE_ROLES);
    const key = requireSourceKey(sourceKey);
    const mapping = this.svc.requireMapping(key);
    if (mapping.sourceKind !== 'sql') {
      throw new BadRequestException(`Source "${key}" is not a SQL source`);
    }
    const resolvedClientId = requireClientId(clientId);
    const client = await this.clientsSvc.requireById(resolvedClientId);
    const from = requireDate(fromRaw, 'from');
    const to = requireDate(toRaw, 'to');

    const result = await this.parseSvc.startSqlParse({
      sourceKey: key,
      mapping,
      displayName: `${mapping.label} (${fromRaw} to ${toRaw})`,
      clientId: resolvedClientId,
      clientKey: client.key,
      from,
      to,
      createdBy: roleId,
    });
    return { runId: result.runId, jobId: result.jobId, rowsPulled: result.rowsPulled };
  }

  // ─── runs ─────────────────────────────────────────────────────────────────

  @Get('runs')
  async listRuns(
    @Query('limit') limit?: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    return this.runsSvc.listRuns(limit ? Number(limit) : 25);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string, @Headers('authorization') auth?: string) {
    this.svc.requireRole(auth, READ_ROLES);
    return this.runsSvc.getRun(id);
  }

  /** Staged rows, filtered and capped server-side. */
  @Get('runs/:id/rows')
  async listRows(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('onlyIssues') onlyIssues?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    return this.runsSvc.listRows(id, {
      status,
      onlyIssues: onlyIssues === 'true' || onlyIssues === '1',
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Full detail for one staged row: issues, parsed messages, raw source row. */
  @Get('runs/:id/rows/:rowNumber')
  async getRowDetail(
    @Param('id') id: string,
    @Param('rowNumber', ParseIntPipe) rowNumber: number,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    return this.runsSvc.getRowDetail(id, rowNumber);
  }

  @Patch('runs/:id/rows/:rowNumber')
  async setRowExcluded(
    @Param('id') id: string,
    @Param('rowNumber', ParseIntPipe) rowNumber: number,
    @Body() dto: ExcludeRowDto,
    @Headers('authorization') auth?: string,
  ) {
    const { roleId } = this.svc.requireRole(auth, WRITE_ROLES);
    return this.runsSvc.setRowExcluded(
      id,
      rowNumber,
      dto.excluded,
      dto.reason ?? null,
      roleId,
    );
  }

  /** Bulk exclude by validation status, e.g. "exclude all warnings". */
  @Post('runs/:id/exclude')
  async excludeByStatus(
    @Param('id') id: string,
    @Body() dto: ExcludeStatusDto,
    @Headers('authorization') auth?: string,
  ) {
    const { roleId } = this.svc.requireRole(auth, WRITE_ROLES);
    return this.runsSvc.excludeByStatus(
      id,
      dto.statuses,
      dto.reason ?? 'Excluded in bulk by operator',
      roleId,
    );
  }

  /**
   * Re-derives the conversation key from a different column, using the already
   * staged rawJson — no re-upload needed.
   */
  @Post('runs/:id/rekey')
  async rekey(
    @Param('id') id: string,
    @Body() dto: RekeyDto,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    const run = await this.runsSvc.requireRun(id);
    const mapping = this.svc.requireMapping(run.sourceKey);
    return this.parseSvc.rekey(id, dto.naturalKeyColumn, mapping);
  }

  @Post('runs/:id/revalidate')
  async revalidate(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    await this.runsSvc.requireRun(id);
    await this.parseSvc.revalidate(id);
    return this.runsSvc.getRun(id);
  }

  /** Deletes the run and everything staged under it (FK cascade). */
  @Delete('runs/:id')
  async discardRun(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    return this.runsSvc.discardRun(id);
  }

  /** Drops staged rows but keeps the run header as an audit record. */
  @Post('runs/:id/purge-staging')
  async purgeStaging(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, WRITE_ROLES);
    return this.runsSvc.purgeStaging(id);
  }

  // ─── promote ──────────────────────────────────────────────────────────────

  /** What a promote would do. Writes nothing. */
  @Get('runs/:id/promote-preview')
  async promotePreview(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    await this.runsSvc.requireRun(id);
    return this.promoteSvc.previewPromote(id);
  }

  /**
   * Promotes the run's eligible rows into app.interactions,
   * interaction_transcripts, interaction_csat and interaction_survey.
   * Returns as soon as the background job is scheduled.
   */
  @Post('runs/:id/promote')
  async promote(@Param('id') id: string, @Headers('authorization') auth?: string) {
    this.svc.requireRole(auth, WRITE_ROLES);
    const run = await this.runsSvc.requireRun(id);
    const mapping = this.svc.requireMapping(run.sourceKey);
    return this.promoteSvc.startPromote(id, mapping);
  }

  // ─── rollback ─────────────────────────────────────────────────────────────

  /** What a rollback would destroy. Writes nothing. */
  @Get('runs/:id/rollback-preview')
  async rollbackPreview(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    const run = await this.runsSvc.requireRun(id);
    const mapping = this.svc.requireMapping(run.sourceKey);
    return this.promoteSvc.previewRollback(id, mapping);
  }

  /**
   * Undoes a promote. dev-only, and requires the run id typed back as
   * confirmation — this destroys promoted interactions and cascades away any
   * insights generated from them.
   */
  @Post('runs/:id/rollback')
  async rollback(
    @Param('id') id: string,
    @Body() dto: RollbackDto,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, DANGER_ROLES);
    const run = await this.runsSvc.requireRun(id);
    const expected = `ROLLBACK ${id.slice(0, 8)}`;
    if (dto.confirm?.trim().toUpperCase() !== expected.toUpperCase()) {
      throw new BadRequestException(
        `Confirmation does not match. Send confirm: "${expected}".`,
      );
    }
    const mapping = this.svc.requireMapping(run.sourceKey);
    return this.promoteSvc.rollback(id, mapping);
  }

  // ─── dedupe report ────────────────────────────────────────────────────────

  /**
   * Source keys duplicated in app.interactions. Must be empty before
   * add-interactions-source-key-unique.sql can be applied.
   */
  @Get('dedupe-report')
  async dedupeReport(
    @Query('limit') limit?: string,
    @Headers('authorization') auth?: string,
  ) {
    this.svc.requireRole(auth, READ_ROLES);
    const rows = await this.promoteSvc.dedupeReport(
      limit ? Number(limit) : 200,
    );
    return { duplicateGroups: rows.length, rows };
  }
}

function requireSourceKey(value: string | undefined): string {
  const key = (value ?? '').trim();
  if (!key) {
    throw new BadRequestException('Missing "sourceKey" query parameter');
  }
  return key;
}

// Every interaction a run promotes is stamped with this client (see
// import-promote.service.ts), so staging refuses to start without one — the
// same "safe by default" principle as the clientId backfill: an unassigned
// interaction is only ever visible to internal staff, never a client login.
function requireClientId(value: string | undefined): string {
  const clientId = (value ?? '').trim();
  if (!clientId) {
    throw new BadRequestException('Missing "clientId" query parameter');
  }
  return clientId;
}

/** Parses a `?from=`/`?to=` query param into a Date, rejecting anything ambiguous. */
function requireDate(value: string | undefined, paramName: string): Date {
  const raw = (value ?? '').trim();
  if (!raw) {
    throw new BadRequestException(`Missing "${paramName}" query parameter`);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`"${paramName}" is not a valid date: "${raw}"`);
  }
  return parsed;
}

/**
 * Uploads must land on disk, not in memory: the default multer storage buffers
 * the whole body into the worker heap, which a large export would exhaust.
 */
function requireDiskUpload(
  file: Express.Multer.File | undefined,
): Express.Multer.File & { path: string } {
  if (!file) throw new BadRequestException('Missing file field "file"');
  if (!file.path) {
    throw new BadRequestException(
      'Upload was buffered in memory. Set IMPORT_UPLOAD_DIR so uploads stream to disk.',
    );
  }
  assertAllowedExtension(file.originalname);
  return file as Express.Multer.File & { path: string };
}
