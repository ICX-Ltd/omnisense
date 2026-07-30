import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertAllowedExtension,
  hashFile,
  listInboxFiles,
  readHead,
  resolveInboxFile,
  resolveInsideDir,
} from './file-source';

let tmpDir: string;
const originalInbox = process.env.IMPORT_INBOX_DIR;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aii-inbox-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  if (originalInbox === undefined) delete process.env.IMPORT_INBOX_DIR;
  else process.env.IMPORT_INBOX_DIR = originalInbox;
});

describe('resolveInsideDir — path traversal guard', () => {
  // This is the backend's only filesystem entry point, so the guard is the
  // whole security boundary for operator-supplied names.
  it('resolves a plain file name inside the directory', () => {
    const full = resolveInsideDir('/data/inbox', 'export.csv');
    expect(full).toBe(path.resolve('/data/inbox', 'export.csv'));
  });

  it.each([
    '../../etc/passwd',
    '..\\..\\windows\\system32\\config',
    'subdir/../../escape.csv',
    '/etc/passwd',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
  ])('strips any directory part from %p', (name) => {
    const full = resolveInsideDir(tmpDir, name);
    // basename() reduces every one of these to a leaf inside the root.
    expect(full.startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
    expect(full).toBe(path.resolve(tmpDir, path.basename(name)));
  });

  it.each(['', '.', '..'])('rejects the degenerate name %p', (name) => {
    expect(() => resolveInsideDir(tmpDir, name)).toThrow(/Invalid file name/);
  });
});

describe('assertAllowedExtension', () => {
  it.each(['export.csv', 'export.tsv', 'export.txt', 'EXPORT.CSV'])(
    'accepts %s',
    (name) => {
      expect(() => assertAllowedExtension(name)).not.toThrow();
    },
  );

  it.each(['export.xlsx', 'export.zip', 'export.exe', 'export'])(
    'rejects %s',
    (name) => {
      expect(() => assertAllowedExtension(name)).toThrow(/Unsupported file type/);
    },
  );
});

describe('listInboxFiles', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(tmpDir, 'older.csv'), 'a\tb\n1\t2\n');
    await fs.writeFile(path.join(tmpDir, 'newer.tsv'), 'a\tb\n3\t4\n');
    await fs.writeFile(path.join(tmpDir, 'ignored.xlsx'), 'binary');
    await fs.mkdir(path.join(tmpDir, 'a-subdirectory'), { recursive: true });

    // Make the ordering deterministic rather than relying on write timing.
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(tmpDir, 'older.csv'), past, past);

    process.env.IMPORT_INBOX_DIR = tmpDir;
  });

  it('lists only allowed file types, newest first', async () => {
    const files = await listInboxFiles();
    expect(files.map((f) => f.name)).toEqual(['newer.tsv', 'older.csv']);
  });

  it('ignores directories rather than descending into them', async () => {
    const files = await listInboxFiles();
    expect(files.map((f) => f.name)).not.toContain('a-subdirectory');
  });

  it('reports size and modified time', async () => {
    const files = await listInboxFiles();
    expect(files[0]!.sizeBytes).toBeGreaterThan(0);
    // Assert the value, not the constructor: fs returns a Date from a different
    // realm than the test context, so toBeInstanceOf(Date) is unreliable here.
    expect(Number.isFinite(files[0]!.modifiedAt.getTime())).toBe(true);
    expect(files[0]!.modifiedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('explains itself when the inbox is not configured', async () => {
    delete process.env.IMPORT_INBOX_DIR;
    await expect(listInboxFiles()).rejects.toThrow(/IMPORT_INBOX_DIR is not configured/);
    process.env.IMPORT_INBOX_DIR = tmpDir;
  });

  it('explains itself when the inbox does not exist', async () => {
    process.env.IMPORT_INBOX_DIR = path.join(tmpDir, 'does-not-exist');
    await expect(listInboxFiles()).rejects.toThrow(/does not exist/);
    process.env.IMPORT_INBOX_DIR = tmpDir;
  });
});

describe('resolveInboxFile', () => {
  beforeAll(() => {
    process.env.IMPORT_INBOX_DIR = tmpDir;
  });

  it('resolves an existing file', async () => {
    await expect(resolveInboxFile('older.csv')).resolves.toBe(
      path.join(tmpDir, 'older.csv'),
    );
  });

  it('404s for a file that is not there', async () => {
    await expect(resolveInboxFile('nope.csv')).rejects.toThrow(/No such file/);
  });

  it('refuses a disallowed extension before touching the filesystem', async () => {
    await expect(resolveInboxFile('ignored.xlsx')).rejects.toThrow(
      /Unsupported file type/,
    );
  });

  it('cannot be walked out of the inbox', async () => {
    // Even though this file exists, the name is reduced to its basename, which
    // does not exist inside the inbox.
    await expect(resolveInboxFile('../../../etc/passwd.csv')).rejects.toThrow(
      /No such file/,
    );
  });
});

describe('readHead', () => {
  it('reads at most the requested byte count', async () => {
    const file = path.join(tmpDir, 'head.csv');
    await fs.writeFile(file, 'abcdefghij');
    expect((await readHead(file, 4)).toString()).toBe('abcd');
  });

  it('returns the whole file when it is shorter than the request', async () => {
    const file = path.join(tmpDir, 'short.csv');
    await fs.writeFile(file, 'ab');
    const head = await readHead(file, 1024);
    expect(head.length).toBe(2);
    expect(head.toString()).toBe('ab');
  });
});

describe('hashFile', () => {
  it('produces a stable sha256 for the same content', async () => {
    const a = path.join(tmpDir, 'h1.csv');
    const b = path.join(tmpDir, 'h2.csv');
    await fs.writeFile(a, 'identical content');
    await fs.writeFile(b, 'identical content');
    const [ha, hb] = [await hashFile(a), await hashFile(b)];
    expect(ha).toBe(hb);
    expect(ha).toHaveLength(64);
  });

  it('differs for different content', async () => {
    const a = path.join(tmpDir, 'h3.csv');
    const b = path.join(tmpDir, 'h4.csv');
    await fs.writeFile(a, 'one');
    await fs.writeFile(b, 'two');
    expect(await hashFile(a)).not.toBe(await hashFile(b));
  });
});
