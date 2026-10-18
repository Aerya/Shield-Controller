import { BlockList, isIP } from 'net';

export interface ResolverIdentity {
    address: string;
    provider: string | null;
    source: 'known-service' | 'network-owner' | 'unknown';
}

// Published service addresses, not assumptions based on an ISP's whole network.
// https://developers.cloudflare.com/1.1.1.1/ip-addresses/
// https://developers.google.com/speed/public-dns/docs/using
// https://docs.quad9.net/services/
// https://adguard-dns.io/en/public-dns.html
const services = new Map<string, string>();
for (const [provider, addresses] of [
    ['Cloudflare', ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']],
    ['Google Public DNS', ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844']],
    [
        'Quad9',
        [
            '9.9.9.9',
            '149.112.112.112',
            '2620:fe::fe',
            '2620:fe::9',
            '9.9.9.10',
            '149.112.112.10',
            '2620:fe::10',
            '2620:fe::fe:10',
            '9.9.9.11',
            '149.112.112.11',
            '2620:fe::11',
            '2620:fe::fe:11',
        ],
    ],
    ['AdGuard DNS', ['94.140.14.14', '94.140.15.15', '2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff']],
] as const) {
    for (const address of addresses) services.set(address, provider);
}
const excluded = new BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3],
] as const)
    excluded.addSubnet(address, prefix, 'ipv4');
excluded.addSubnet('2001:db8::', 32, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const cache = new Map<string, { value: ResolverIdentity; expires: number }>();

/** IP ownership enrichment only. Unique DNS test names are never resolved here. */
export async function identifyResolvers(addresses: string[]): Promise<ResolverIdentity[]> {
    const signal = AbortSignal.timeout(5000);
    const unique = [...new Set(addresses)];
    const results = new Map<string, ResolverIdentity>();
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, unique.length) }, async () => {
            while (next < unique.length) {
                const address = unique[next++]!;
                const family = address.includes('%') ? 0 : isIP(address);
                const canonical = family === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
                const known = services.get(canonical);
                let value: ResolverIdentity = {
                    address,
                    provider: known ?? null,
                    source: known ? 'known-service' : 'unknown',
                };
                const publicAddress =
                    family === 4
                        ? !excluded.check(address, 'ipv4')
                        : family === 6 && globalV6.check(address, 'ipv6') && !excluded.check(address, 'ipv6');
                if (!known && publicAddress) {
                    const cached = cache.get(canonical);
                    if (cached && cached.expires > Date.now()) value = { ...cached.value, address };
                    else if (!signal.aborted) {
                        try {
                            const response = await fetch(
                                `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(address)}`,
                                { signal, redirect: 'error' },
                            );
                            if (!response.ok) throw new Error('Ownership lookup unavailable');
                            const data = await response.json();
                            const owners = Array.isArray(data?.data?.asns) ? data.data.asns : [];
                            const labels: string[] = owners
                                .slice(0, 4)
                                .flatMap((owner: { holder?: unknown; asn?: unknown }) =>
                                    typeof owner.holder === 'string' &&
                                    owner.holder.trim() &&
                                    typeof owner.asn === 'number' &&
                                    Number.isSafeInteger(owner.asn) &&
                                    owner.asn > 0
                                        ? [`${owner.holder.trim().slice(0, 160)} (AS${owner.asn})`]
                                        : [],
                                );
                            if (labels.length)
                                value = { address, provider: labels.join(' / '), source: 'network-owner' };
                        } catch {
                            /* Keep the IP visible when metadata is unavailable. */
                        }
                        if (cache.size >= 512) cache.delete(cache.keys().next().value!);
                        cache.set(canonical, { value, expires: Date.now() + (value.provider ? 86400000 : 300000) });
                    }
                }
                results.set(address, value);
            }
        }),
    );
    return unique.map((address) => results.get(address)!);
}
