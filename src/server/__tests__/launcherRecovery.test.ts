import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LauncherRecovery } from '../LauncherRecovery';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
});
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'launcher-recovery-'));
    roots.push(root);
    const stock = 'com.google.android.tvlauncher';
    const original = `${stock}/${stock}.Main`;
    const target = 'com.alternative.home/com.alternative.home.Main';
    let home = original;
    let front = original;
    let enabled = 0;
    let user = 0;
    let failHome = false;
    let failRestore = false;
    let persistent = false;
    const adb = {
        shell: vi.fn(async (_serial: string, cmd: string): Promise<string> => {
            if (cmd === 'am get-current-user') return String(user);
            if (cmd.startsWith('settings --user')) return '1';
            if (cmd.includes('query-activities')) return `${original}\n${target}`;
            if (cmd.includes('resolve-activity')) return home;
            if (cmd === 'dumpsys package')
                return `Package [${stock}] (abc):\n pkgFlags=[ SYSTEM ${persistent ? 'PERSISTENT' : ''} ]`;
            if (cmd.startsWith('dumpsys package '))
                return `pkgFlags=[ SYSTEM ]\nUser 0: installed=true hidden=false enabled=${enabled}`;
            if (cmd.includes('set-home-activity')) {
                home = cmd.includes(target) ? target : original;
                return 'Success';
            }
            if (cmd.includes('pm disable-user')) {
                enabled = 3;
                return '';
            }
            if (cmd.includes('pm default-state') || cmd.includes('pm enable')) {
                if (failRestore) throw new Error('offline');
                enabled = 0;
                return '';
            }
            if (cmd.startsWith('pm list packages -d')) return enabled === 3 ? `package:${stock}` : '';
            if (cmd.includes('am start') && cmd.includes(target)) {
                front = target;
                return 'Status: ok';
            }
            if (cmd.includes('android.settings.SETTINGS')) {
                front = 'com.android.tv.settings/.Main';
                return 'Status: ok';
            }
            if (cmd === 'input keyevent KEYCODE_HOME') {
                front = failHome ? original : home;
                return '';
            }
            if (cmd === 'dumpsys activity activities') return `mResumedActivity: ActivityRecord{a u0 ${front} t1}`;
            throw new Error(cmd);
        }),
    };
    return {
        adb,
        service: () => new LauncherRecovery(adb, root),
        target,
        stock,
        original,
        user: (value: number) => {
            user = value;
        },
        persistent: () => {
            persistent = true;
        },
        breakHome: (restore = false) => {
            failHome = true;
            failRestore = restore;
        },
        restoreConnection: () => {
            failRestore = false;
        },
        state: () => ({ home, enabled }),
    };
}
describe('launcher recovery', () => {
    it('diagnoses without device writes and rejects unsafe or unconfirmed choices', async () => {
        const f = fixture();
        const service = f.service();
        expect((await service.diagnose('tv', 0)).candidates).toEqual([f.stock]);
        await expect(service.apply('tv', 0, f.target, f.stock, false)).rejects.toThrow('Confirm');
        await expect(service.apply('tv', 0, 'evil; reboot', f.stock, true)).rejects.toThrow('Choose');
        await expect(service.apply('tv', 0, f.target, 'com.android.settings', true)).rejects.toThrow('Choose');
        f.persistent();
        await expect(service.apply('tv', 0, f.target, f.stock, true)).rejects.toThrow('Choose');
        expect(f.adb.shell.mock.calls.some(([, cmd]) => /pm disable|set-home|am start/.test(cmd))).toBe(false);
    });
    it('verifies the alternative before disabling, then restores the exact original enabled state after restart', async () => {
        const f = fixture();
        await f.service().apply('tv', 0, f.target, f.stock, true);
        expect(f.state()).toEqual({ home: f.target, enabled: 3 });
        const calls = f.adb.shell.mock.calls.map(([, cmd]) => cmd);
        expect(calls.findIndex((cmd) => cmd.includes('am start') && cmd.includes(f.target))).toBeLessThan(
            calls.findIndex((cmd) => cmd.includes('pm disable-user')),
        );
        expect(f.service().saved('tv', 0)?.stock).toBe(f.stock);
        expect(f.service().saved('tv', 10)).toBeNull();
        await f.service().restore('tv', 0);
        expect(f.state()).toEqual({ home: f.original, enabled: 0 });
        expect(f.service().saved('tv', 0)).toBeNull();
    });
    it('rolls back a failed Home test', async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.breakHome();
        const result = expect(f.service().apply('tv', 0, f.target, f.stock, true)).rejects.toThrow(
            'Original launcher restored',
        );
        await vi.runAllTimersAsync();
        await result;
        expect(f.state()).toEqual({ home: f.original, enabled: 0 });
    });
    it('keeps recovery after a disconnect and refuses the wrong user', async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.breakHome(true);
        const result = expect(f.service().apply('tv', 0, f.target, f.stock, true)).rejects.toThrow(
            'Use Restore stock launcher',
        );
        await vi.runAllTimersAsync();
        await result;
        expect(f.service().saved('tv', 0)).not.toBeNull();
        f.user(10);
        await expect(f.service().restore('tv', 0)).rejects.toThrow('user changed');
        f.user(0);
        f.restoreConnection();
        await f.service().restore('tv', 0);
        expect(f.state().enabled).toBe(0);
    });
});
