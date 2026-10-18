import { describe, expect, it, vi } from 'vitest';
import type { AdbClient } from '../AdbClient';
import { DeviceNetwork, parseDns, validDomain } from '../DeviceNetwork';

describe('device DNS controls', () => {
    it('accepts domain names and both DNS address families without allowing shell payloads', () => {
        expect(validDomain('example.com')).toBe(true);
        for (const domain of ['-x', 'example.com; reboot', '1.1.1.1', 'https://example.com', 'a'.repeat(64) + '.com'])
            expect(validDomain(domain)).toBe(false);
        expect(parseDns('DnsAddresses: [ /fd00::1,/192.0.2.1 ] DnsAddresses: [/192.0.2.1]')).toEqual([
            'fd00::1',
            '192.0.2.1',
        ]);
    });
    it('tests actual Shield resolution and does not confuse blocked ICMP with DNS failure', async () => {
        const shell = vi.fn(async (_serial, command: string) =>
            !command.includes('ping6')
                ? 'PING example.com (192.0.2.1) 56 bytes\n100% packet loss'
                : 'ping: unknown host',
        );
        const result = (await new DeviceNetwork({ shell } as unknown as AdbClient).test(
            'device',
            'example.com',
            '',
        )) as any;
        expect(result.origin).toBe('device');
        expect(result.results[0].addresses).toEqual(['192.0.2.1']);
        expect(result.results[1].addresses).toEqual([]);
    });
    it('rolls back both settings if Android refuses the change', async () => {
        const shell = vi.fn(async (_serial, command: string) =>
            command.endsWith('private_dns_mode') ? 'off' : command.endsWith('private_dns_specifier') ? 'null' : '',
        );
        const network = new DeviceNetwork({ shell } as unknown as AdbClient);
        await expect(network.configure('device', 'hostname', 'dns.example.com')).rejects.toThrow('refused');
        expect(shell.mock.calls.map((call) => call[1])).toContain("settings put global private_dns_mode 'off'");
        expect(shell.mock.calls.map((call) => call[1])).toContain('settings delete global private_dns_specifier');
    });
    it('rejects unsafe values before writing any device setting', async () => {
        const shell = vi.fn();
        const network = new DeviceNetwork({ shell } as unknown as AdbClient);
        await expect(network.configure('device', 'hostname', '1.1.1.1')).rejects.toThrow('hostname');
        await expect(network.test('device', 'example.com', '1.1.1.1; id')).rejects.toThrow('IPv4');
        expect(shell).not.toHaveBeenCalled();
    });
});
