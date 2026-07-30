import {
  countFields,
  decodeBuffer,
  detectEncoding,
  normaliseHeaders,
  sniffDelimited,
  sniffFailureReason,
} from './csv-sniff';

const utf16le = (s: string) => Buffer.from(s, 'utf16le');
const utf16leBom = (s: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const utf8Bom = (s: string) =>
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, 'utf8')]);

describe('detectEncoding', () => {
  it('detects plain UTF-8', () => {
    expect(detectEncoding(Buffer.from('a,b,c\n1,2,3'))).toEqual({
      encoding: 'utf8',
      bomLength: 0,
    });
  });

  it('detects and measures a UTF-8 BOM', () => {
    expect(detectEncoding(utf8Bom('a,b,c'))).toEqual({
      encoding: 'utf8bom',
      bomLength: 3,
    });
  });

  it('detects UTF-16LE with a BOM (the Excel "Unicode text" case)', () => {
    expect(detectEncoding(utf16leBom('a\tb\tc'))).toEqual({
      encoding: 'utf16le',
      bomLength: 2,
    });
  });

  it('detects UTF-16BE with a BOM', () => {
    const be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      (() => {
        const b = Buffer.from('a\tb\tc', 'utf16le');
        b.swap16();
        return b;
      })(),
    ]);
    expect(detectEncoding(be)).toEqual({ encoding: 'utf16be', bomLength: 2 });
  });

  it('detects BOM-less UTF-16LE from NUL density', () => {
    // Without this, every header comes back NUL-padded and matches nothing.
    const { encoding } = detectEncoding(utf16le('conversationId\tbrandId\tstartTime'));
    expect(encoding).toBe('utf16le');
  });

  it('does not mistake ordinary UTF-8 for UTF-16', () => {
    const wide = Buffer.from('col1,col2,col3\n' + 'x'.repeat(4000));
    expect(detectEncoding(wide).encoding).toBe('utf8');
  });
});

describe('decodeBuffer', () => {
  it('round-trips UTF-16LE', () => {
    expect(decodeBuffer(utf16le('héllo\tworld'), 'utf16le')).toBe('héllo\tworld');
  });

  it('round-trips UTF-16BE by byte-swapping', () => {
    const b = Buffer.from('héllo\tworld', 'utf16le');
    b.swap16();
    expect(decodeBuffer(b, 'utf16be')).toBe('héllo\tworld');
  });

  it('leaves the caller buffer unmodified when swapping', () => {
    const b = Buffer.from('ab', 'utf16le');
    const before = Buffer.from(b);
    decodeBuffer(b, 'utf16be');
    expect(b.equals(before)).toBe(true);
  });
});

describe('countFields', () => {
  it('counts simple fields', () => {
    expect(countFields('a,b,c', ',')).toBe(3);
  });

  it('ignores delimiters inside quoted fields', () => {
    // The transcript column is quoted and full of commas.
    expect(countFields('a,"b,c,d",e', ',')).toBe(3);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    expect(countFields('a,"he said ""hi"", then left",c', ',')).toBe(3);
  });

  it('counts tab-separated fields', () => {
    expect(countFields('a\tb\tc\td', '\t')).toBe(4);
  });

  it('does not count a tab inside a quoted field', () => {
    expect(countFields('a\t"b\tc"\td', '\t')).toBe(3);
  });
});

describe('sniffDelimited', () => {
  it('picks tab for a tab-separated file named .csv', () => {
    // The actual LivePerson case: .csv extension, tab delimited.
    const header = 'conversationId\tbrandId\tstartTime\tcampaignName\ttranscriptAll';
    const r = sniffDelimited(Buffer.from(header + '\nrow\n'));
    expect(r.delimiter).toBe('\t');
    expect(r.columnCount).toBe(5);
  });

  it('picks comma for a genuine CSV', () => {
    const r = sniffDelimited(Buffer.from('a,b,c,d\n1,2,3,4\n'));
    expect(r.delimiter).toBe(',');
    expect(r.columnCount).toBe(4);
  });

  it('prefers tab when prose commas outnumber nothing else', () => {
    // Two tab columns, but the second contains commas. Tab must still win
    // because quoted commas are not counted.
    const r = sniffDelimited(Buffer.from('id\t"a, b, c, d, e"\n'));
    expect(r.delimiter).toBe('\t');
  });

  it('reads the header through a UTF-16LE BOM', () => {
    const r = sniffDelimited(utf16leBom('conversationId\tbrandId\tstartTime\n'));
    expect(r.encoding).toBe('utf16le');
    expect(r.headerLine).toBe('conversationId\tbrandId\tstartTime');
    expect(r.delimiter).toBe('\t');
    expect(r.columnCount).toBe(3);
  });

  it('strips a UTF-8 BOM from the first header name', () => {
    const r = sniffDelimited(utf8Bom('conversationId,brandId\n'));
    expect(r.headerLine.startsWith('conversationId')).toBe(true);
  });

  it('honours a forced delimiter', () => {
    const r = sniffDelimited(Buffer.from('a,b\tc\n'), { forcedDelimiter: ',' });
    expect(r.delimiter).toBe(',');
  });

  it('reports per-candidate counts for diagnostics', () => {
    const r = sniffDelimited(Buffer.from('a\tb\tc\n'));
    expect(r.counts['\t']).toBe(3);
    expect(r.counts[',']).toBe(1);
  });

  it('handles a file with no newline at all', () => {
    const r = sniffDelimited(Buffer.from('a\tb\tc'));
    expect(r.columnCount).toBe(3);
  });
});

describe('sniffFailureReason', () => {
  it('flags a header that parsed as one field', () => {
    const r = sniffDelimited(Buffer.from('justonecolumn\n'));
    expect(sniffFailureReason(r)).toMatch(/single field/);
  });

  it('flags a column count far below what the source expects', () => {
    const r = sniffDelimited(Buffer.from('a\tb\tc\n'));
    expect(sniffFailureReason(r, 330)).toMatch(/expects around 330/);
  });

  it('passes a plausible header', () => {
    const header = Array.from({ length: 330 }, (_, i) => `c${i}`).join('\t');
    const r = sniffDelimited(Buffer.from(header + '\n'));
    expect(sniffFailureReason(r, 330)).toBeNull();
  });

  it('passes when no expectation is given and there are 2+ columns', () => {
    const r = sniffDelimited(Buffer.from('a\tb\n'));
    expect(sniffFailureReason(r)).toBeNull();
  });
});

describe('normaliseHeaders', () => {
  it('trims and unquotes', () => {
    expect(normaliseHeaders(['"conversationId"', '  brandId  '])).toEqual([
      'conversationId',
      'brandId',
    ]);
  });

  it('names blank headers positionally so every column stays addressable', () => {
    expect(normaliseHeaders(['a', '', 'c'])).toEqual(['a', 'column_2', 'c']);
  });

  it('disambiguates duplicates rather than losing a column', () => {
    expect(normaliseHeaders(['status', 'status', 'status'])).toEqual([
      'status',
      'status__2',
      'status__3',
    ]);
  });
});
