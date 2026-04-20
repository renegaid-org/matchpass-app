import { describe, it, expect } from 'vitest';
import { validateBlossomUrl } from './blossom';

describe('validateBlossomUrl', () => {
  it('accepts an https public URL', () => {
    expect(() => validateBlossomUrl('https://blossom.matchpass.club')).not.toThrow();
  });

  it('rejects http://', () => {
    expect(() => validateBlossomUrl('http://blossom.matchpass.club'))
      .toThrow(/https/);
  });

  it('rejects javascript: URIs', () => {
    expect(() => validateBlossomUrl('javascript:alert(1)')).toThrow();
  });

  it('rejects file:// URIs', () => {
    expect(() => validateBlossomUrl('file:///etc/passwd')).toThrow();
  });

  it('rejects cloud metadata hostnames', () => {
    expect(() => validateBlossomUrl('https://169.254.169.254/latest/meta-data/'))
      .toThrow(/blocked/);
    expect(() => validateBlossomUrl('https://metadata.google.internal/'))
      .toThrow(/blocked/);
  });

  it('rejects localhost and RFC1918', () => {
    expect(() => validateBlossomUrl('https://localhost/')).toThrow(/blocked/);
    expect(() => validateBlossomUrl('https://10.0.0.1/')).toThrow(/blocked/);
    expect(() => validateBlossomUrl('https://192.168.1.1/')).toThrow(/blocked/);
    expect(() => validateBlossomUrl('https://172.16.0.1/')).toThrow(/blocked/);
  });

  it('rejects garbage strings', () => {
    expect(() => validateBlossomUrl('not-a-url')).toThrow();
  });
});
