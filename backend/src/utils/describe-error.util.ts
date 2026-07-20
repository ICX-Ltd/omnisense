/**
 * Node's global `fetch` (undici) throws a bare `TypeError: fetch failed` on any
 * network-level failure (DNS, TCP connect, TLS, timeout) — the actionable
 * detail lives one level down in `error.cause` (an Error carrying `code`,
 * `syscall`, `address`, `port`). This walks the cause chain and produces a
 * single human-readable line so it can be stored in `lastError` / logged,
 * turning "fetch failed" into e.g. "connect ETIMEDOUT 127.0.0.1:443".
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let cur: any = err;
  const seen = new Set<any>();
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const bits: string[] = [];
    if (typeof cur.message === 'string' && cur.message) bits.push(cur.message);
    // Low-level socket detail (present on undici's cause).
    const detail = [cur.code, cur.syscall, cur.errno]
      .filter((v) => v != null && v !== '')
      .join(' ');
    if (detail && !bits.join(' ').includes(String(cur.code))) bits.push(detail);
    if (cur.address) bits.push(`${cur.address}${cur.port ? ':' + cur.port : ''}`);
    const line = bits.join(' ').trim();
    if (line && !parts.includes(line)) parts.push(line);
    cur = cur.cause;
  }
  const out = parts.join(' — caused by: ');
  return out || String(err);
}
