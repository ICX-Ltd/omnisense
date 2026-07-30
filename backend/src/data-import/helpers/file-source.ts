// Filesystem access for the importer.
//
// This is the only place in the backend that touches the filesystem, so the
// path-traversal guard lives here and every intake route goes through it. A
// caller must never join an operator-supplied name onto a directory itself.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';

/** Extensions the inbox will offer. The delimiter is sniffed, not assumed. */
export const ALLOWED_EXTENSIONS = ['.csv', '.tsv', '.txt'];

export interface InboxFile {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export function inboxDir(): string | null {
  const dir = process.env.IMPORT_INBOX_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export function uploadDir(): string | null {
  const dir = process.env.IMPORT_UPLOAD_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

/**
 * Resolves an operator-supplied filename inside `dir`.
 *
 * basename() strips any directory part, then the resolved path is re-checked
 * against the root — belt and braces, so neither "../../etc/passwd" nor an
 * absolute path nor a symlinked name can escape.
 */
export function resolveInsideDir(dir: string, name: string): string {
  const root = path.resolve(dir);
  const base = path.basename(name);
  if (!base || base === '.' || base === '..') {
    throw new BadRequestException(`Invalid file name: ${JSON.stringify(name)}`);
  }
  const full = path.resolve(root, base);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new BadRequestException(
      `Resolved path escapes the import directory: ${JSON.stringify(name)}`,
    );
  }
  return full;
}

export function assertAllowedExtension(name: string): void {
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(
      `Unsupported file type "${ext || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    );
  }
}

/**
 * Lists candidate files in the configured inbox, newest first. Non-recursive
 * and files only — a directory in the inbox is ignored rather than descended.
 */
export async function listInboxFiles(): Promise<InboxFile[]> {
  const dir = inboxDir();
  if (!dir) {
    throw new BadRequestException(
      'IMPORT_INBOX_DIR is not configured, so server-side files cannot be listed.',
    );
  }

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === 'ENOENT') {
      throw new BadRequestException(`IMPORT_INBOX_DIR does not exist: ${dir}`);
    }
    throw new BadRequestException(
      `Could not read IMPORT_INBOX_DIR (${dir}): ${(e as Error).message}`,
    );
  }

  const out: InboxFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) continue;
    const stat = await fs.stat(path.join(dir, entry.name));
    out.push({
      name: entry.name,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime,
    });
  }
  out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return out;
}

/** Resolves an inbox file name to a readable absolute path. */
export async function resolveInboxFile(name: string): Promise<string> {
  const dir = inboxDir();
  if (!dir) {
    throw new BadRequestException('IMPORT_INBOX_DIR is not configured.');
  }
  assertAllowedExtension(name);
  const full = resolveInsideDir(dir, name);
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    throw new NotFoundException(`No such file in the import inbox: ${path.basename(name)}`);
  }
  return full;
}

/** Reads the first `bytes` of a file, for sniffing. */
export async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function fileSize(filePath: string): Promise<number> {
  return (await fs.stat(filePath)).size;
}

/** SHA-256 of a file, streamed. Used to spot the same file imported twice. */
export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve());
  });
  return hash.digest('hex');
}

/** Best-effort cleanup of a finished upload. Never throws. */
export async function deleteQuietly(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // The temp file may already be gone; nothing depends on its removal.
  }
}
