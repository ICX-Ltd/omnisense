// Encoding and delimiter detection for imported delimited files.
//
// Both matter in practice and neither can be assumed:
//   - The LivePerson export is named .csv but is TAB separated.
//   - Excel's "Unicode text" save produces UTF-16LE, which decoded as UTF-8
//     yields headers riddled with NUL bytes and a parse that silently matches
//     nothing.

export type FileEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be';

export const CANDIDATE_DELIMITERS = ['\t', ',', ';', '|'] as const;
export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

export interface SniffResult {
  encoding: FileEncoding;
  /** Byte length of the BOM, to be skipped before parsing. */
  bomLength: number;
  delimiter: Delimiter;
  /** Field count the winning delimiter produces on the header line. */
  columnCount: number;
  /** Field count per candidate, for diagnostics in the UI. */
  counts: Record<string, number>;
  /** The decoded header line, BOM stripped. */
  headerLine: string;
}

/** How much of the file to read when sniffing. Header rows are wide but bounded. */
export const SNIFF_BYTES = 256 * 1024;

export function detectEncoding(buf: Buffer): {
  encoding: FileEncoding;
  bomLength: number;
} {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf8bom', bomLength: 3 };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf16le', bomLength: 2 };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf16be', bomLength: 2 };
  }

  // BOM-less UTF-16 still happens. ASCII text encoded as UTF-16LE puts a NUL in
  // every second byte, so a high NUL density in the first chunk is conclusive —
  // no legitimate UTF-8 delimited file contains NUL at all.
  const probe = buf.subarray(0, Math.min(buf.length, 2048));
  let nulls = 0;
  let oddNulls = 0;
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0x00) {
      nulls++;
      if (i % 2 === 1) oddNulls++;
    }
  }
  if (nulls > probe.length / 4) {
    // NULs concentrated in the odd bytes => little-endian.
    return {
      encoding: oddNulls >= nulls / 2 ? 'utf16le' : 'utf16be',
      bomLength: 0,
    };
  }

  return { encoding: 'utf8', bomLength: 0 };
}

export function decodeBuffer(buf: Buffer, encoding: FileEncoding): string {
  switch (encoding) {
    case 'utf16le':
      return buf.toString('utf16le');
    case 'utf16be': {
      // Node has no utf16be decoder — byte-swap into LE first. Copy so the
      // caller's buffer is left intact.
      const swapped = Buffer.from(buf);
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    default:
      return buf.toString('utf8');
  }
}

/**
 * Counts fields the delimiter would produce on one line, respecting RFC4180
 * double-quoting so a delimiter inside a quoted transcript is not counted.
 */
export function countFields(line: string, delimiter: string): number {
  let fields = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++; // escaped quote
        continue;
      }
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === delimiter) {
      fields++;
    }
  }
  return fields;
}

/**
 * Sniffs encoding and delimiter from the head of a file.
 *
 * `expectedColumns` enables the sanity gate: when the winning delimiter yields
 * fewer than half the columns the mapping expects, the caller should fail the
 * run with a clear message rather than staging a whole file as one field.
 */
export function sniffDelimited(
  head: Buffer,
  opts: { forcedDelimiter?: Delimiter; expectedColumns?: number } = {},
): SniffResult {
  const { encoding, bomLength } = detectEncoding(head);
  const text = decodeBuffer(head.subarray(bomLength), encoding);

  // The header line is effectively never quoted across a newline, so taking the
  // first physical line is safe and avoids parsing the whole chunk.
  const newline = text.search(/\r?\n/);
  const headerLine = newline === -1 ? text : text.slice(0, newline);

  const counts: Record<string, number> = {};
  for (const d of CANDIDATE_DELIMITERS) {
    counts[d] = countFields(headerLine, d);
  }

  let delimiter: Delimiter;
  if (opts.forcedDelimiter) {
    delimiter = opts.forcedDelimiter;
  } else {
    // Highest field count wins; CANDIDATE_DELIMITERS order breaks ties, putting
    // tab ahead of comma (a tab-separated file with commas inside prose would
    // otherwise be misread as CSV).
    delimiter = CANDIDATE_DELIMITERS.reduce((best, d) =>
      counts[d]! > counts[best]! ? d : best,
    );
  }

  return {
    encoding,
    bomLength,
    delimiter,
    columnCount: counts[delimiter]!,
    counts,
    headerLine,
  };
}

/**
 * Returns a human-readable reason when a sniff result looks wrong, or null when
 * it is usable. Kept separate from sniffDelimited so preview can report the
 * problem alongside the evidence instead of throwing.
 */
export function sniffFailureReason(
  result: SniffResult,
  expectedColumns?: number,
): string | null {
  if (result.columnCount < 2) {
    return (
      `Could not find a column delimiter in the header row — it parsed as a ` +
      `single field. Checked tab, comma, semicolon and pipe.`
    );
  }
  if (expectedColumns && result.columnCount < Math.floor(expectedColumns / 2)) {
    return (
      `Header row parsed as ${result.columnCount} columns using ` +
      `${describeDelimiter(result.delimiter)}, but this source expects around ` +
      `${expectedColumns}. The file may use a different delimiter or be a ` +
      `different export.`
    );
  }
  return null;
}

export function describeDelimiter(d: string): string {
  if (d === '\t') return 'tab';
  if (d === ',') return 'comma';
  if (d === ';') return 'semicolon';
  if (d === '|') return 'pipe';
  return JSON.stringify(d);
}

/**
 * Normalises a header cell: strips wrapping quotes and surrounding whitespace.
 * Duplicate and blank headers are disambiguated positionally so that every
 * column stays addressable in rawJson — LivePerson exports do contain repeats.
 */
export function normaliseHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? '').replace(/^"+|"+$/g, '').trim();
    if (!name) name = `column_${i + 1}`;
    const priorCount = seen.get(name);
    if (priorCount === undefined) {
      seen.set(name, 1);
      return name;
    }
    seen.set(name, priorCount + 1);
    return `${name}__${priorCount + 1}`;
  });
}
