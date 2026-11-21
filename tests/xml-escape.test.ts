import { describe, expect, it } from 'vitest';
import { esc } from '../src/shared/render';

describe('XML escaping of the SVG title', () => {
  it('drops characters XML 1.0 forbids', () => {
    expect(esc('a\u0000b\u0007c\u000Bd\u001Fe￾f￿')).toBe('abcdef');
    expect(esc('битый \uD83D суррогат \uDE00')).toBe('битый  суррогат ');
  });

  it('keeps what XML allows and escapes markup', () => {
    expect(esc('строка\tс\nпереводом\r')).toBe('строка\tс\nпереводом\r');
    expect(esc('эмодзи 😀 ок')).toBe('эмодзи 😀 ок');
    expect(esc('<&>"')).toBe('&lt;&amp;&gt;&quot;');
  });

  it('a phrase with a control character still gives a well-formed title', () => {
    const title = esc('Вечер\u0001 с книгой');
    expect(title).toBe('Вечер с книгой');
    expect(title).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });
});
