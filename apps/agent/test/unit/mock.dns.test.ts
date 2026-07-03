import { describe, expect, it } from 'vitest';
import { DnsError, MockDnsManager } from '../../src/dns/mock.dns.js';

describe('MockDnsManager', () => {
  it('expone estadísticas coherentes con la blocklist', async () => {
    const dns = new MockDnsManager();
    const stats = await dns.getStats();
    expect(stats.totalQueries).toBeGreaterThan(0);
    expect(stats.blockedPercent).toBe(Math.round((stats.blockedQueries / stats.totalQueries) * 100));
    expect(stats.blocklistSize).toBe((await dns.listBlocked()).length);
  });

  it('añade un dominio (normalizado) y actualiza el tamaño', async () => {
    const dns = new MockDnsManager();
    const before = (await dns.getStats()).blocklistSize;
    const entry = await dns.addBlocked('  ADS.Nuevo.COM  ');
    expect(entry.domain).toBe('ads.nuevo.com');
    expect((await dns.getStats()).blocklistSize).toBe(before + 1);
  });

  it('rechaza un dominio duplicado', async () => {
    const dns = new MockDnsManager();
    await dns.addBlocked('dup.example.com');
    await expect(dns.addBlocked('dup.example.com')).rejects.toBeInstanceOf(DnsError);
  });

  it('elimina un dominio y devuelve false si no existía', async () => {
    const dns = new MockDnsManager();
    const entry = await dns.addBlocked('quitar.example.com');
    expect(await dns.removeBlocked(entry.id)).toBe(true);
    expect(await dns.removeBlocked(entry.id)).toBe(false);
  });

  it('devuelve las consultas recientes respetando el límite', async () => {
    const dns = new MockDnsManager();
    const all = await dns.recentQueries();
    expect(all.length).toBeGreaterThan(0);
    expect(await dns.recentQueries(2)).toHaveLength(2);
  });

  it('togglea los feeds de categoría del catálogo (US-114)', async () => {
    const dns = new MockDnsManager();
    let feeds = await dns.listFeeds();
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.every((f) => !f.enabled)).toBe(true);

    const updated = await dns.setFeedEnabled('ads', true);
    expect(updated.enabled).toBe(true);
    feeds = await dns.listFeeds();
    expect(feeds.find((f) => f.id === 'ads')?.enabled).toBe(true);

    await expect(dns.setFeedEnabled('desconocido', true)).rejects.toBeInstanceOf(DnsError);
  });
});
