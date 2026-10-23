import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, stat } from 'fs/promises';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdbClient } from '../AdbClient';
import { DeviceManagerApi, parseApplications } from '../api/DeviceManagerApi';
import { DeviceOptimization } from '../DeviceOptimization';

const policy = vi.hoisted(() => ({ allowed: true }));
vi.mock('../auth/requireOperator', () => ({
    requireOperator: (_req: unknown, res: any) => {
        if (policy.allowed) return true;
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'forbidden' }));
        return false;
    },
}));

let journalRoot: string;
let server: Server;
let base: string;
const serial = '192.0.2.20:5555';
const adb = {
    devices: vi.fn(async () => [{ serial, state: 'device' }]),
    shell: vi.fn(
        async (_serial: string, command: string): Promise<string> =>
            command === 'getprop' ? '[ro.product.model]: [SHIELD]' : '',
    ),
    screenshot: vi.fn(async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])),
    installApk: vi.fn(async (_serial: string, _path: string) => 'Success'),
};

beforeEach(async () => {
    policy.allowed = true;
    vi.clearAllMocks();
    adb.shell.mockImplementation(async (_serial, command) =>
        command === 'getprop' ? '[ro.product.model]: [SHIELD]' : '',
    );
    adb.installApk.mockResolvedValue('Success');
    adb.devices.mockResolvedValue([{ serial, state: 'device' }]);
    journalRoot = mkdtempSync(join(tmpdir(), 'optimization-api-'));
    const api = new DeviceManagerApi(
        adb as unknown as AdbClient,
        new DeviceOptimization(adb as unknown as AdbClient, journalRoot),
    );
    server = createServer((req, res) => {
        void api.handle(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/manager/`;
});
afterEach(async () => {
    rmSync(journalRoot, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
});
const url = (route: string, target = serial) => `${base}${route}?serial=${encodeURIComponent(target)}`;

describe('device management HTTP API', () => {
    it('delivers binary PNG captures without conversion or caching', async () => {
        const response = await fetch(url('screenshot'));
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(await adb.screenshot());
    });
    it('refuses every route before touching ADB when the operator gate rejects access', async () => {
        policy.allowed = false;
        for (const [route, method] of [
            ['screenshot', 'GET'],
            ['dns', 'GET'],
            ['dns', 'POST'],
            ['dns-test', 'POST'],
            ['internet', 'POST'],
            ['info', 'GET'],
            ['apps', 'GET'],
            ['install', 'POST'],
            ['uninstall', 'POST'],
            ['optimization', 'GET'],
            ['optimization', 'POST'],
        ]) {
            expect((await fetch(url(route!), { method: method! })).status).toBe(403);
        }
        expect(adb.devices).not.toHaveBeenCalled();
    });
    it('rejects argument injection and unauthorized devices', async () => {
        expect((await fetch(url('info', '-H'))).status).toBe(400);
        adb.devices.mockResolvedValue([{ serial, state: 'unauthorized' }]);
        expect((await fetch(url('info'))).status).toBe(409);
    });
    it('returns device properties while preserving partial information on unsupported commands', async () => {
        adb.shell.mockImplementation(async (_serial, command) => {
            if (command === 'getprop') return '[ro.product.model]: [SHIELD]';
            throw new Error('unsupported');
        });
        const response = await fetch(url('info'));
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.properties['ro.product.model']).toBe('SHIELD');
        expect(data.storage).toBe('Unavailable on this device');
    });
    it('parses version codes, system and disabled flags without treating paths as package names', () => {
        expect(
            parseApplications(
                'package:/data/app/base.apk=org.example.app versionCode:42\npackage:/system/app/a.apk=com.vendor.tv versionCode:7\ngarbage',
                'package:com.vendor.tv',
                'package:org.example.app',
            ),
        ).toEqual([
            {
                packageName: 'com.vendor.tv',
                path: '/system/app/a.apk',
                versionCode: '7',
                system: true,
                disabled: false,
            },
            {
                packageName: 'org.example.app',
                path: '/data/app/base.apk',
                versionCode: '42',
                system: false,
                disabled: true,
            },
        ]);
    });
    it('rejects shell injection without executing a package command', async () => {
        const response = await fetch(url('uninstall'), {
            method: 'POST',
            body: JSON.stringify({ packageName: 'com.test;reboot' }),
        });
        expect(response.status).toBe(400);
        expect(adb.shell).not.toHaveBeenCalled();
    });
    it('uninstalls only for user 0 and reports Android refusal', async () => {
        adb.shell.mockImplementation(async (_serial, command) => {
            if (command.includes('resolve-activity')) return 'com.home.app/.Home';
            if (command === 'dumpsys activity activities') return 'ACTIVITY MANAGER ACTIVITIES';
            if (command === 'dumpsys media_session') return 'MEDIA SESSION SERVICE';
            return 'Failure [DELETE_FAILED_INTERNAL_ERROR]';
        });
        const response = await fetch(url('uninstall'), {
            method: 'POST',
            body: JSON.stringify({ packageName: 'org.example.app' }),
        });
        expect(response.status).toBe(422);
        expect(adb.shell).toHaveBeenCalledWith(serial, "pm uninstall --user 0 'org.example.app'", 60_000);
    });
    it('streams an APK to a private file, installs it, and removes the temporary file', async () => {
        let staged = '';
        const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]);
        adb.installApk.mockImplementation(async (_serial, path) => {
            staged = path;
            expect(await readFile(path)).toEqual(payload);
            expect((await stat(path)).mode & 0o777).toBe(0o600);
            return 'Success';
        });
        const response = await fetch(url('install'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.android.package-archive' },
            body: payload,
        });
        expect(response.status).toBe(200);
        expect((await response.json()).success).toBe(true);
        await vi.waitFor(async () => {
            await expect(stat(staged)).rejects.toThrow();
        });
    });
    it('cleans temporary files after an Android install failure', async () => {
        let staged = '';
        adb.installApk.mockImplementation(async (_serial, path) => {
            staged = path;
            throw new Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
        });
        const response = await fetch(url('install'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.android.package-archive' },
            body: Buffer.from('PK\x03\x04test'),
        });
        expect(response.status).toBe(502);
        expect((await response.json()).error).toContain('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
        await vi.waitFor(async () => {
            await expect(stat(staged)).rejects.toThrow();
        });
    });
    it('rejects non-APK and malformed JSON input', async () => {
        expect((await fetch(url('install'), { method: 'POST', body: 'not an APK' })).status).toBe(415);
        expect(
            (
                await fetch(url('install'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/vnd.android.package-archive' },
                    body: 'not an APK',
                })
            ).status,
        ).toBe(400);
        expect(adb.installApk).not.toHaveBeenCalled();
        expect((await fetch(url('uninstall'), { method: 'POST', body: '{' })).status).toBe(400);
    });
});

it('blocks uninstall of a live launcher even through the existing endpoint', async () => {
    adb.shell.mockImplementation(async (_serial, command) => {
        if (command.includes('resolve-activity')) return 'com.home.app/.Home';
        if (command === 'dumpsys activity activities') return 'ACTIVITY MANAGER ACTIVITIES';
        if (command === 'dumpsys media_session') return 'MEDIA SESSION SERVICE';
        return '';
    });
    const response = await fetch(url('uninstall'), {
        method: 'POST',
        body: JSON.stringify({ packageName: 'com.home.app' }),
    });
    expect(response.status).toBe(400);
    expect(adb.shell.mock.calls.some(([, command]) => command.startsWith('pm uninstall'))).toBe(false);
});
