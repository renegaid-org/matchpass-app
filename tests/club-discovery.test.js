import { describe, it, expect } from 'vitest';
import { ClubDiscovery } from '../server/club-discovery.js';

describe('ClubDiscovery URL validation', () => {
  it('accepts an https URL with a public hostname', () => {
    expect(() => new ClubDiscovery('https://matchpass.club')).not.toThrow();
  });

  it('rejects file:// URLs', () => {
    expect(() => new ClubDiscovery('file:///etc/passwd')).toThrow(/unsupported protocol/);
  });

  it('rejects javascript: URLs', () => {
    expect(() => new ClubDiscovery('javascript:alert(1)')).toThrow();
  });

  it('rejects AWS metadata endpoint', () => {
    expect(() => new ClubDiscovery('http://169.254.169.254/')).toThrow(/blocked/);
  });

  it('rejects localhost', () => {
    expect(() => new ClubDiscovery('http://localhost:8080/')).toThrow(/blocked/);
    expect(() => new ClubDiscovery('http://127.0.0.1/')).toThrow(/blocked/);
  });

  it('rejects RFC1918 ranges', () => {
    expect(() => new ClubDiscovery('http://10.0.0.1/')).toThrow(/blocked/);
    expect(() => new ClubDiscovery('http://192.168.1.1/')).toThrow(/blocked/);
    expect(() => new ClubDiscovery('http://172.16.0.1/')).toThrow(/blocked/);
  });

  it('rejects link-local IPv4', () => {
    expect(() => new ClubDiscovery('http://169.254.1.1/')).toThrow(/blocked/);
  });

  it('rejects GCP metadata hostname', () => {
    expect(() => new ClubDiscovery('http://metadata.google.internal/')).toThrow(/blocked/);
  });
});
