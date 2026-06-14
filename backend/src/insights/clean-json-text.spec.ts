import { cleanJsonText } from './insights.service';

describe('cleanJsonText', () => {
  it('passes a clean object through unchanged', () => {
    expect(cleanJsonText('{"a":1}')).toBe('{"a":1}');
  });

  it('strips ```json fences', () => {
    expect(cleanJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips bare ``` fences', () => {
    expect(cleanJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('salvages an object wrapped in prose', () => {
    expect(cleanJsonText('Here is the JSON:\n{"a":1}\nHope that helps!')).toBe('{"a":1}');
  });

  it('salvages with leading prose only', () => {
    expect(cleanJsonText('Sure! {"a":1,"b":[2,3]}')).toBe('{"a":1,"b":[2,3]}');
  });

  it('keeps the outermost braces for nested objects', () => {
    const obj = '{"a":{"b":2},"c":3}';
    expect(cleanJsonText(`prefix ${obj} suffix`)).toBe(obj);
  });

  it('is idempotent', () => {
    const once = cleanJsonText('```json\n{"a":1}\n```');
    expect(cleanJsonText(once)).toBe(once);
  });
});
