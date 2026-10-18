import { afterEach, expect, it, vi } from 'vitest';
import { identifyResolvers } from '../ResolverIdentity';

afterEach(() => vi.unstubAllGlobals());

it('recognizes public DNS services in IPv4 and equivalent IPv6 notation without a network lookup', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await identifyResolvers([
        '1.1.1.1',
        '8.8.4.4',
        '2620:00FE:0000:0000:0000:0000:0000:00FE',
        '94.140.14.14',
    ]);
    expect(result.map((row) => row.provider)).toEqual(['Cloudflare', 'Google Public DNS', 'Quad9', 'AdGuard DNS']);
    expect(result.every((row) => row.source === 'known-service')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
});

it('identifies arbitrary public IPv4/IPv6 network owners, deduplicates and caches their metadata', async () => {
    const fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { asns: [{ holder: 'Example operator', asn: 64500 }] } }),
    }));
    vi.stubGlobal('fetch', fetch);
    const addresses = ['80.1.2.3', '2001:4860::1234', '80.1.2.3'];
    const result = await identifyResolvers(addresses);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ address: '80.1.2.3', provider: 'Example operator (AS64500)', source: 'network-owner' });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls as unknown as [string, RequestInit][]) {
        expect(url).toMatch(/^https:\/\/stat\.ripe\.net\/data\/prefix-overview\/data\.json\?resource=/);
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.redirect).toBe('error');
    }
    await identifyResolvers(addresses);
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('preserves unknown addresses on external failure and skips local, reserved or invalid addresses', async () => {
    const fetch = vi.fn(async () => {
        throw new Error('timeout');
    });
    vi.stubGlobal('fetch', fetch);
    const addresses = [
        '81.2.3.4',
        '192.168.1.1',
        '127.0.0.1',
        '192.0.2.1',
        '::1',
        'fd00::1',
        '2001:db8::53',
        'not an IP',
        'fe80::1%eth0',
    ];
    const result = await identifyResolvers(addresses);
    expect(result.map((row) => row.address)).toEqual(addresses);
    expect(result.every((row) => row.provider === null && row.source === 'unknown')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
});

it('ignores malformed owner data without losing resolver addresses', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
            ok: true,
            json: async () => ({
                data: {
                    asns: [
                        { holder: {}, asn: 12 },
                        { holder: 'Bad ASN', asn: 'bad' },
                    ],
                },
            }),
        })),
    );
    expect(await identifyResolvers(['82.3.4.5'])).toEqual([{ address: '82.3.4.5', provider: null, source: 'unknown' }]);
});
