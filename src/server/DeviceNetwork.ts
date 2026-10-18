import { Resolver } from 'dns/promises';
import { isIP } from 'net';
import type { AdbClient } from './AdbClient';
import { shArg } from './security/deviceInput';

export class DnsInputError extends Error {}

export function validDomain(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= 253 &&
        !isIP(value) &&
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(value)
    );
}

export function parseDns(text: string): string[] {
    return [
        ...new Set(
            [...text.matchAll(/DnsAddresses:\s*\[([^\]]*)\]/g)].flatMap((match) =>
                match[1]!
                    .split(',')
                    .map((item) => item.trim().replace(/^\//, ''))
                    .filter((item) => isIP(item)),
            ),
        ),
    ];
}

export class DeviceNetwork {
    constructor(private readonly adb: AdbClient) {}

    async status(serial: string): Promise<unknown> {
        const [connectivity, mode, hostname] = await Promise.all([
            this.adb.shell(serial, 'dumpsys connectivity'),
            this.adb.shell(serial, 'settings get global private_dns_mode'),
            this.adb.shell(serial, 'settings get global private_dns_specifier'),
        ]);
        return {
            servers: parseDns(connectivity),
            mode: mode === 'null' ? 'opportunistic' : mode,
            hostname: hostname === 'null' ? '' : hostname,
            privateDnsValidated: /ValidatedPrivateDnsAddresses:\s*\[\s*[^\s\]]/.test(connectivity),
            ethernetDnsEditable: false,
        };
    }

    async test(serial: string, domain: unknown, server: unknown): Promise<unknown> {
        if (!validDomain(domain)) throw new DnsInputError('Enter a valid domain name.');
        if (server !== undefined && server !== '' && (typeof server !== 'string' || !isIP(server)))
            throw new DnsInputError('Enter an IPv4 or IPv6 DNS server.');
        if (typeof server === 'string' && server) {
            const resolver = new Resolver({ timeout: 3000, tries: 1 });
            resolver.setServers([server]);
            const answers = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
            return {
                origin: 'server',
                server,
                domain,
                results: answers.map((item, i) => ({
                    family: i === 0 ? 'IPv4' : 'IPv6',
                    addresses: item.status === 'fulfilled' ? item.value : [],
                    error: item.status === 'rejected' ? String(item.reason?.code ?? item.reason) : null,
                })),
            };
        }
        const results = await Promise.all(
            [4, 6].map(async (family) => {
                // ICMP may be blocked: the PING header proves DNS resolution independently of packet delivery.
                let output: string;
                try {
                    output = await this.adb.shell(
                        serial,
                        `${family === 4 ? 'ping' : 'ping6'} -c 1 -W 2 ${shArg(domain)} 2>&1; true`,
                        8000,
                    );
                } catch (error) {
                    output = error instanceof Error ? error.message : String(error);
                }
                const address = /\(([^)]+)\)/.exec(output)?.[1] ?? '';
                return {
                    family: `IPv${family}`,
                    addresses: isIP(address) ? [address] : [],
                    error: isIP(address) ? null : output.slice(0, 500),
                };
            }),
        );
        return { origin: 'device', domain, results };
    }

    async configure(serial: string, mode: unknown, hostname: unknown): Promise<unknown> {
        if (!['off', 'opportunistic', 'hostname'].includes(String(mode)))
            throw new DnsInputError('Invalid Private DNS mode.');
        if (mode === 'hostname' && !validDomain(hostname))
            throw new DnsInputError('Private DNS requires a provider hostname, not an IP address.');
        const previousMode = await this.adb.shell(serial, 'settings get global private_dns_mode');
        const previousHost = await this.adb.shell(serial, 'settings get global private_dns_specifier');
        const restore = async (): Promise<void> => {
            for (const [key, value] of [
                ['private_dns_specifier', previousHost],
                ['private_dns_mode', previousMode],
            ]) {
                await this.adb.shell(
                    serial,
                    value === 'null' ? `settings delete global ${key}` : `settings put global ${key} ${shArg(value!)}`,
                );
            }
        };
        try {
            if (mode === 'hostname')
                await this.adb.shell(serial, `settings put global private_dns_specifier ${shArg(hostname as string)}`);
            await this.adb.shell(serial, `settings put global private_dns_mode ${shArg(mode as string)}`);
            const readback = await this.adb.shell(serial, 'settings get global private_dns_mode');
            const host = await this.adb.shell(serial, 'settings get global private_dns_specifier');
            if (readback !== mode || (mode === 'hostname' && host !== hostname))
                throw new Error('Android refused the Private DNS settings.');
            return this.status(serial);
        } catch (error) {
            try {
                await restore();
            } catch {
                throw new Error(
                    'DNS change failed; restoring the previous settings also failed. Check the TV network settings.',
                );
            }
            throw error;
        }
    }
}
