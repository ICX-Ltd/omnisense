// Runs a SQL-source pull and reshapes the result into the same
// {headers, row} shape the file reader (delimited-reader.ts) produces, so
// stageRow() and everything downstream (validation passes, promote) is
// unaware the data ever came from a query rather than a file.
//
// `icx-rep` (the source BI database) is a SQL Server linked server configured
// at the instance level, reachable via three/four-part names in any query run
// against this app's own database — so this reads through the existing
// DataSource, no second connection.

import { DataSource } from 'typeorm';
import { toNaiveIso } from './parse-date';
import { SourceRow } from '../mappings/mapping.types';

export interface SqlQuery {
  text: string;
  /** Bind values only — see SqlSourceConfig.buildQuery. */
  values: unknown[];
}

export interface SqlReadResult {
  headers: string[];
  rows: SourceRow[];
}

/**
 * Every cell becomes a string, matching what a CSV row already looks like to
 * stageRow(). Dates use the naive-local form (no Z/offset) — the same reason
 * toNaiveIso exists for transcript timestamps: a Z-suffixed value would shift
 * by the server process's UTC offset once re-parsed, moving a wall-clock
 * value like start_date_time to a different hour (or day, near midnight).
 */
function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : toNaiveIso(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Runs a parameterized query and returns every row as a SourceRow. Not a
 * stream: a SQL-source pull is a bounded date-range window, not an
 * arbitrarily large file, so reading it into memory in one shot is fine.
 */
export async function readSqlSource(
  ds: DataSource,
  query: SqlQuery,
): Promise<SqlReadResult> {
  const raw: Array<Record<string, unknown>> = await ds.query(query.text, query.values);
  const headers = raw.length ? Object.keys(raw[0]!) : [];
  const rows: SourceRow[] = raw.map((record) => {
    const row: SourceRow = {};
    for (const h of headers) row[h] = stringifyCell(record[h]);
    return row;
  });
  return { headers, rows };
}
