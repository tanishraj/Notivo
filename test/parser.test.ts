import { describe, expect, it } from 'vitest';
import { documentLink, fetchListing, parseListing } from '../src/nmc';
import first from './fixtures/nmc-first.html?raw';
import last from './fixtures/nmc-last.html?raw';
import { listing, site } from './helpers';

describe('NMC extraction', () => {
  it('parses the actual first page, including entities, dates, and non-monotonic IDs', async () => {
    const parsed = await parseListing(new Response(first), 1);
    expect(parsed.total).toBe(1016);
    expect(parsed.lastPage).toBe(51);
    expect(parsed.notices).toHaveLength(20);
    expect(parsed.notices[0]).toMatchObject({ id: '1880', publishedOn: '2026-10-15' });
    expect(parsed.notices[0]!.title).toContain('"Kayakalp Activities');
    expect(parsed.notices.some((n) => n.id === '48')).toBe(true);
    expect(parsed.notices[0]!.title).not.toMatch(/New$/);
  });

  it('parses the shorter final archive page', async () => {
    const parsed = await parseListing(new Response(last), 51);
    expect(parsed.notices).toHaveLength(16);
    expect(parsed.notices[0]!.id).toBe('874');
    expect(parsed.notices[0]!.publishedOn).toBe('2018-03-08');
    expect(parsed.notices[8]!.documentUrl).toBeNull();
    expect(parsed.notices[8]!.title).toContain("Hon'ble");
    expect(parsed.notices[13]!.publishedOn).toBeNull();
  });

  it('fails on an empty page or a security challenge', async () => {
    await expect(parseListing(new Response('<html>Checking your browser...</html>'), 1)).rejects.toThrow('missing or empty');
  });

  it('fails if pagination silently returns the wrong page', async () => {
    await expect(parseListing(new Response(first), 2)).rejects.toThrow('pagination');
  });

  it('fails on malformed rows rather than dropping them', async () => {
    await expect(parseListing(new Response(listing(['1']).replace('class="wn-title-link"', 'class="changed"')), 1)).rejects.toThrow('no title');
    await expect(parseListing(new Response(listing(['1', '1'])), 1)).rejects.toThrow('Duplicate');
  });

  it('rejects unsafe URLs and normalizes an NMC HTTP link to HTTPS', () => {
    expect(documentLink('http://nmc.org.in/whats-new/download/48').url).toBe('https://nmc.org.in/whats-new/download/48');
    expect(() => documentLink('https://evil.example/whats-new/download/48')).toThrow();
    expect(() => documentLink('javascript:alert(1)')).toThrow();
    expect(() => documentLink('https://nmc.org.in:8443/whats-new/download/48')).toThrow();
  });

  it('fetches HTML only and reports persistent upstream errors', async () => {
    await fetchListing(1, async (_url, options) => {
      expect(options?.redirect).toBe('manual');
      return new Response(listing(['1']), { headers: { 'Content-Type': 'text/html' } });
    });
    const parsed = await fetchListing(1, site(listing(['1'])));
    expect(parsed.notices[0]!.id).toBe('1');
    await expect(fetchListing(1, async () => new Response('Missing', { status: 404 }))).rejects.toThrow('HTTP 404');
    await expect(fetchListing(1, async () => new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }))).rejects.toThrow('non-HTML');
  });
});
