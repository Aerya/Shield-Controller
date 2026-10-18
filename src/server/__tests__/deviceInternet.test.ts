import { expect, it, vi } from 'vitest';
import type { AdbClient } from '../AdbClient';
import { DeviceInternet, detectedResolvers, parseHttpJson } from '../DeviceInternet';

it('parses successful responses and exposes only resolver IPs', () => {
    expect(
        detectedResolvers(
            parseHttpJson(
                'HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{"ip":{"192.0.2.53":2,"2001:db8::53":1,"invalid":1}}',
            ),
        ),
    ).toEqual(['192.0.2.53', '2001:db8::53']);
    expect(() => parseHttpJson('HTTP/1.1 301 Moved\r\n\r\n{}')).toThrow();
});
it('performs every request on Android and preserves one working family when IPv6 fails', async () => {
    const shell = vi.fn(async (_serial: string, command: string) => {
        if (command.includes('nc -6')) throw new Error('unreachable');
        expect(command).toContain("printf '%b'");
        return (
            'HTTP/1.0 200 OK\r\n\r\n' +
            JSON.stringify(command.includes('/json/') ? { ip: '198.51.100.2' } : { ip: { '192.0.2.53': 2 } })
        );
    });
    const result = (await new DeviceInternet({ shell } as unknown as AdbClient).detect('device')) as any;
    expect(result.origin).toBe('device');
    expect(result.results[0].address).toBe('198.51.100.2');
    expect(result.results[1].address).toBeNull();
    expect(result.resolvers).toEqual(['192.0.2.53']);
    const names = shell.mock.calls.map((call) => call[1]).filter((command) => command.includes('/dnsdetection/'));
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
});
