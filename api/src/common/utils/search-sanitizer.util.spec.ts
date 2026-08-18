import { createSafeSearchRegex, sanitizeSearchQuery } from './search-sanitizer.util';

describe('sanitizeSearchQuery', () => {
  it('preserves letters from non-Latin scripts', () => {
    // The old ASCII whitelist erased these completely, leaving an empty term. Callers that skip
    // their filter on an empty term then matched every document instead of none.
    expect(sanitizeSearchQuery('美食')).toBe('美食');
    expect(sanitizeSearchQuery('旅行')).toBe('旅行');
    expect(sanitizeSearchQuery('潜水 摄影')).toBe('潜水 摄影');
    expect(sanitizeSearchQuery('ゲーム')).toBe('ゲーム');
    expect(sanitizeSearchQuery('사진')).toBe('사진');
  });

  it('preserves accented and decomposed Latin text', () => {
    expect(sanitizeSearchQuery('Đà Nẵng')).toBe('Đà Nẵng');
    // Same word written with combining marks rather than precomposed characters.
    expect(sanitizeSearchQuery('Hà Nội')).toBe('Hà Nội');
  });

  it('still strips punctuation, symbols and Mongo operators', () => {
    expect(sanitizeSearchQuery('hello.*')).toBe('hello');
    expect(sanitizeSearchQuery('$where this.password')).toBe('thispassword');
    expect(sanitizeSearchQuery('{ "$ne": null }')).toBe('null');
    expect(sanitizeSearchQuery('🎉')).toBe('');
  });

  it('rejects non-strings and over-long input', () => {
    expect(() => sanitizeSearchQuery({ $ne: null } as any)).toThrow();
    expect(() => sanitizeSearchQuery('a'.repeat(101))).toThrow();
  });
});

describe('createSafeSearchRegex', () => {
  it('builds a regex that matches CJK content literally', () => {
    const regex = createSafeSearchRegex('美食');

    expect(regex).not.toBeNull();
    expect(regex!.test('今天的美食探店日记')).toBe(true);
    expect(regex!.test('unrelated english text')).toBe(false);
  });

  it('is case-insensitive and matches partial words', () => {
    const regex = createSafeSearchRegex('DIV');

    expect(regex!.test('Amazing Diving Trip in Bali')).toBe(true);
  });

  it('treats regex metacharacters as literal text rather than syntax', () => {
    const regex = createSafeSearchRegex('a-b_c');

    expect(regex!.test('a-b_c')).toBe(true);
    // Nothing survives sanitisation here, so there is no term left to search on.
    expect(createSafeSearchRegex('.*')).toBeNull();
  });

  it('returns null for empty input so callers can decide what "no term" means', () => {
    expect(createSafeSearchRegex('')).toBeNull();
    expect(createSafeSearchRegex('   ')).toBeNull();
  });
});
