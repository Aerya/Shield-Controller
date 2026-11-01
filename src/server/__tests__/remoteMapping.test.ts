import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { REMOTE, REMOTE_KEYS, RemoteMapping, validateBindings } from '../RemoteMapping';

const binding = { key: 82, tap: 'home', hold: null, double: 'app:com.example.player' };
function fixture() {
    let bindings: unknown[] = [];
    let user = 0;
    const shell = vi.fn(async (_serial: string, cmd: string) => {
        if (cmd === 'am get-current-user') return String(user);
        if (cmd.startsWith('pm list packages')) return `package:${REMOTE.packageName}`;
        if (cmd.startsWith('content call')) {
            const encoded = /--arg '([^']+)'/.exec(cmd)?.[1];
            if (encoded) bindings = JSON.parse(Buffer.from(encoded, 'base64').toString());
            return `Result: Bundle[{payload=${Buffer.from(JSON.stringify({ version: 1, active: true, bindings, apps: [{ packageName: 'com.example.player', label: 'Player' }] })).toString('base64')}}]`;
        }
        if (cmd.startsWith('getprop ro.build')) return '30';
        if (cmd.startsWith('getprop ro.product.manufacturer')) return 'NVIDIA';
        if (cmd.startsWith('am start')) return 'Status: ok';
        throw new Error(cmd);
    });
    const adb = { shell, installApk: vi.fn(async () => 'Success') };
    return {
        adb,
        service: new RemoteMapping(adb),
        switchUser: () => {
            user = 10;
        },
    };
}
describe('remote mapping', () => {
    it('rejects protected keys, duplicate rows, shell input and missing short actions', () => {
        for (const key of [19, 20, 21, 22, 23, 24, 25, 26, 66, 164, 223, 224, 231, '82', 82.5])
            expect(() => validateBindings([{ ...binding, key }])).toThrow();
        expect(() => validateBindings([binding, binding])).toThrow();
        expect(() => validateBindings([{ ...binding, tap: 'app:foo;reboot' }])).toThrow();
        expect(() => validateBindings([{ ...binding, tap: null }])).toThrow();
        expect(() => validateBindings(new Array(21).fill(binding))).toThrow();
        expect(validateBindings([binding])).toEqual([binding]);
    });
    it('reads, verifies a save, and resets without touching accessibility settings', async () => {
        const f = fixture();
        expect((await f.service.status('tv', 0)).installed).toBe(true);
        expect((await f.service.save('tv', 0, [binding])).bindings).toEqual([binding]);
        expect((await f.service.save('tv', 0, [])).bindings).toEqual([]);
        expect(f.adb.shell.mock.calls.some(([, c]) => /settings put|settings delete/.test(c))).toBe(false);
    });
    it('rejects removed applications and user switches before writing', async () => {
        const f = fixture();
        await expect(f.service.save('tv', 0, [{ ...binding, tap: 'app:com.missing.app' }])).rejects.toThrow(
            'unavailable',
        );
        f.switchUser();
        await expect(f.service.save('tv', 0, [binding])).rejects.toThrow('user changed');
        expect(f.adb.shell.mock.calls.some(([, c]) => c.includes('--method set'))).toBe(false);
    });
    it('checks the bundled APK and only installs for supported Android user 0', async () => {
        expect(createHash('sha256').update(readFileSync('assets/launchers/shield-remote.apk')).digest('hex')).toBe(
            REMOTE.sha256,
        );
        const f = fixture();
        await expect(f.service.install('tv', 10)).rejects.toThrow('user 0');
        await f.service.install('tv', 0);
        expect(f.adb.installApk).toHaveBeenCalledOnce();
    });
    it('keeps the Java and web key allowlists in sync', () => {
        const java = readFileSync('companion/src/org/shieldcontroller/remote/GestureEngine.java', 'utf8');
        const expression = /return (key == 3[\s\S]*?);/.exec(java)![1]!;
        const allowed = new Function('key', `return ${expression}`);
        expect(Array.from({ length: 300 }, (_, key) => key).filter((key) => allowed(key))).toEqual(REMOTE_KEYS);
    });
    it('surfaces a missing or incompatible companion instead of claiming success', async () => {
        const f = fixture();
        f.adb.shell.mockImplementation(async (_s, cmd) =>
            cmd === 'am get-current-user' ? '0' : 'Error: provider not found',
        );
        await expect(f.service.save('tv', 0, [])).rejects.toThrow('unavailable');
    });
});
