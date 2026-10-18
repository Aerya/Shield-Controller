import { randomBytes } from 'crypto';
import { isIP } from 'net';
import type { AdbClient } from './AdbClient';
import { identifyResolvers } from './ResolverIdentity';
import { shArg } from './security/deviceInput';

export function parseHttpJson(output: string): Record<string, unknown> {
    const split = output.search(/\r?\n\r?\n/);
    if (!/^HTTP\/1\.[01] 200\b/.test(output) || split < 0 || output.length > 256000)
        throw new Error('External test service did not return a valid response.');
    const body = output.slice(split).trim();
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid external test response.');
    return data as Record<string, unknown>;
}

export function detectedResolvers(data: Record<string, unknown>): string[] {
    const addresses = data['ip'];
    return addresses && typeof addresses === 'object' && !Array.isArray(addresses)
        ? Object.keys(addresses).filter((address) => isIP(address))
        : [];
}

/** Every detection request originates on Android, not on the Docker host. */
export class DeviceInternet {
    constructor(private readonly adb: AdbClient) {}
    private async query(serial: string, host: string, path: string, family: number): Promise<Record<string, unknown>> {
        // Only fixed IPleak hosts or internally generated test names reach this method.
        if (!/^(?:ipv[46]|[a-f0-9]{40}-[a-f0-9]{8})\.ipleak\.net$/.test(host))
            throw new Error('Invalid external test host.');
        const request = `GET ${path} HTTP/1.0\\r\\nHost: ${host}\\r\\nConnection: close\\r\\n\\r\\n`;
        const output = await this.adb.shell(
            serial,
            `printf '%b' ${shArg(request)} | toybox nc -${family} -w 5 -W 5 ${shArg(host)} 80`,
            12000,
        );
        return parseHttpJson(output);
    }
    async detect(serial: string): Promise<unknown> {
        const session = randomBytes(20).toString('hex');
        const results = await Promise.all(
            [4, 6].map(async (family) => {
                let address: string | null = null;
                let error: string | null = null;
                const resolvers = new Set<string>();
                try {
                    const data = await this.query(serial, `ipv${family}.ipleak.net`, '/json/', family);
                    if (typeof data['ip'] === 'string' && isIP(data['ip']) === family) address = data['ip'];
                    else error = 'No public address reported for this IP family.';
                } catch {
                    error = 'Public IP test unavailable for this family (network or Android tools).';
                }
                // Unique names defeat DNS caches. Their resolution and HTTP request both run on the Shield.
                // Never resolve these names on DockerLab: that would contaminate the result.
                for (let i = 0; i < 2; i++) {
                    try {
                        const data = await this.query(
                            serial,
                            `${session}-${randomBytes(4).toString('hex')}.ipleak.net`,
                            '/dnsdetection/',
                            family,
                        );
                        detectedResolvers(data).forEach((item) => {
                            resolvers.add(item);
                        });
                    } catch {
                        /* An unavailable family must not hide the working family's results. */
                    }
                }
                return { family: `IPv${family}`, address, error, resolvers: [...resolvers] };
            }),
        );
        const resolvers = [...new Set(results.flatMap((item) => item.resolvers))];
        return {
            origin: 'device',
            provider: 'IPleak.net',
            testedAt: new Date().toISOString(),
            results,
            resolvers,
            resolverDetails: await identifyResolvers(resolvers),
        };
    }
}
