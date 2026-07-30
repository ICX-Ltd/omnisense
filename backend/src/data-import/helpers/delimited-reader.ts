// Streaming reader for delimited source files.
//
// One code path serves both intake modes and both phases (preview and staging):
// callers hand over a path on disk and get an async iterator of rows. Nothing
// buffers the whole file, so a multi-hundred-MB export is fine.

import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { BadRequestException } from '@nestjs/common';
import {
  Delimiter,
  FileEncoding,
  SNIFF_BYTES,
  describeDelimiter,
  normaliseHeaders,
  sniffDelimited,
  sniffFailureReason,
} from './csv-sniff';
import { readHead } from './file-source';
import { SourceMapping, SourceRow } from '../mappings/mapping.types';

export interface ReaderPlan {
  filePath: string;
  encoding: FileEncoding;
  bomLength: number;
  delimiter: Delimiter;
  headers: string[];
  /** Field count implied by the header row. */
  headerColumnCount: number;
  /** Per-candidate delimiter field counts, for diagnostics. */
  delimiterCounts: Record<string, number>;
}

export interface ReadRow {
  /** 1-based index among data rows (the header is not counted). */
  rowNumber: number;
  row: SourceRow;
  /** Field count for this record, when it differed from the header. */
  fieldCount: number;
}

export interface SkippedRow {
  rowNumber: number | null;
  message: string;
}

/**
 * Sniffs a file and builds the parse plan. Throws BadRequestException with a
 * readable reason when the file clearly is not the expected shape, rather than
 * staging a whole export as a single column.
 */
export async function planRead(
  filePath: string,
  mapping: SourceMapping,
  opts: { forcedDelimiter?: Delimiter } = {},
): Promise<ReaderPlan> {
  const head = await readHead(filePath, SNIFF_BYTES);
  if (head.length === 0) {
    throw new BadRequestException('The file is empty.');
  }

  const forced =
    opts.forcedDelimiter ??
    (mapping.delimiter === 'auto' ? undefined : (mapping.delimiter as Delimiter));

  const sniff = sniffDelimited(head, { forcedDelimiter: forced });

  // Expected width is inferred from the mapping so the gate scales with the
  // source rather than being a magic number.
  const expected = expectedColumnCount(mapping);
  const failure = sniffFailureReason(sniff, expected);
  if (failure) throw new BadRequestException(failure);

  const rawHeaders = splitHeaderLine(sniff.headerLine, sniff.delimiter);
  const headers = normaliseHeaders(rawHeaders);

  return {
    filePath,
    encoding: sniff.encoding,
    bomLength: sniff.bomLength,
    delimiter: sniff.delimiter,
    headers,
    headerColumnCount: headers.length,
    delimiterCounts: sniff.counts,
  };
}

/**
 * Rough count of distinct source columns the mapping references. Used only for
 * the sniff sanity gate, so an approximation is fine.
 */
export function expectedColumnCount(mapping: SourceMapping): number {
  const names = new Set<string>();
  for (const f of mapping.fields) {
    if (!f.column) continue;
    for (const c of Array.isArray(f.column) ? f.column : [f.column]) names.add(c);
  }
  names.add(mapping.transcript.column);
  for (const c of mapping.transcript.agentNameColumns) names.add(c);
  for (const c of mapping.csat.commentColumns) names.add(c);
  return names.size;
}

/** Splits the header line, honouring RFC4180 quoting. */
function splitHeaderLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(field);
      field = '';
      continue;
    }
    field += ch;
  }
  out.push(field);
  return out;
}

export interface IterateOptions {
  /** Stop after this many data rows. Used by preview. */
  limit?: number;
  /** Collector for records the parser could not read. */
  onSkip?: (skipped: SkippedRow) => void;
}

/**
 * Streams data rows from a planned file.
 *
 * Parser options worth noting:
 *   - `trim: false` — transcript indentation is part of the message content.
 *   - `relax_quotes` / `relax_column_count` / `skip_records_with_error` — one
 *     malformed row out of 300k must not abort the whole import; it is reported
 *     and counted instead.
 *   - `columns` is NOT used, so a record whose field count differs from the
 *     header is still readable (csv-parse's column mode would drop or throw).
 */
export async function* iterateRows(
  plan: ReaderPlan,
  opts: IterateOptions = {},
): AsyncGenerator<ReadRow> {
  const parser = parse({
    delimiter: plan.delimiter,
    bom: false, // handled by the byte-offset skip below
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    skip_records_with_error: true,
    trim: false,
    record_delimiter: ['\r\n', '\n', '\r'],
    from_line: 2, // the header is already parsed into plan.headers
  });

  if (opts.onSkip) {
    parser.on('skip', (err: { message?: string; lines?: number }) => {
      opts.onSkip!({
        rowNumber: typeof err?.lines === 'number' ? err.lines - 1 : null,
        message: err?.message ?? 'Malformed record',
      });
    });
  }

  const stream = createReadStream(plan.filePath, {
    start: plan.bomLength,
    // UTF-16 is decoded by the stream itself; a manual decode would risk
    // splitting a surrogate pair across chunk boundaries.
    encoding: plan.encoding === 'utf16le' ? 'utf16le' : 'utf8',
  });

  if (plan.encoding === 'utf16be') {
    // Rare enough that streaming byte-swap is not worth the complexity; the
    // caller is told to re-save the file rather than being handed mojibake.
    stream.destroy();
    throw new BadRequestException(
      'UTF-16BE files are not supported. Re-save the export as UTF-8 or UTF-16LE.',
    );
  }

  const source = stream.pipe(parser);
  let rowNumber = 0;

  try {
    for await (const record of source as AsyncIterable<string[]>) {
      rowNumber++;
      const row: SourceRow = {};
      const n = Math.min(record.length, plan.headers.length);
      for (let i = 0; i < n; i++) {
        row[plan.headers[i]!] = record[i] ?? '';
      }
      // Extra fields beyond the header are preserved positionally so nothing is
      // silently discarded from rawJson.
      for (let i = plan.headers.length; i < record.length; i++) {
        row[`extra_${i + 1}`] = record[i] ?? '';
      }

      yield { rowNumber, row, fieldCount: record.length };

      if (opts.limit && rowNumber >= opts.limit) break;
    }
  } finally {
    // Breaking out of a for-await leaves the stream open otherwise.
    stream.destroy();
    parser.destroy();
  }
}

export function describePlan(plan: ReaderPlan): string {
  return (
    `${plan.headerColumnCount} columns, ${describeDelimiter(plan.delimiter)}-` +
    `separated, ${plan.encoding}`
  );
}
