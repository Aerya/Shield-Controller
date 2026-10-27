import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSnapshot } from '../DeviceSnapshot';
import type { DeviceTweaks } from '../DeviceTweaks';
import { persistentPackages } from '../TvCompatibility';
import { DETOX, TvMaintenance } from '../TvMaintenance';

let root: string;
const home = 'com.home.app/com.home.app.Main';
const other = 'com.other.app/com.other.app.Main';
function setup() {
    let user = 0;
    let foreground = home;
    let homeTarget = home;
    const adb = {
        shell: vi.fn(async (_serial: string, cmd: string) => {
            if (cmd === 'am get-current-user') return String(user);
            if (cmd === 'getprop ro.product.model') return 'SHIELD';
            if (cmd === 'getprop ro.product.manufacturer') return 'NVIDIA';
            if (cmd === 'getprop ro.build.version.sdk') return '30';
            if (cmd.startsWith('pm list packages'))
                return 'package:com.ansub.tvhome\npackage:com.home.app\npackage:com.google.android.apps.tv.launcherx';
            if (cmd === 'dumpsys package') return '  Package [com.home.app] (abc):\n    pkgFlags=[ SYSTEM PERSISTENT ]';
            if (cmd === 'cat /proc/meminfo') return 'MemTotal: 2000000 kB\nMemAvailable: 800000 kB';
            if (cmd === 'cat /proc/uptime') return '600.0 12.0';
            if (cmd === 'cat /proc/sys/kernel/random/boot_id') return '12345678-1234-1234-1234-123456789abc';
            if (cmd.startsWith('head -n 1')) return 'cpu 10 0 10 80 0 0 0 0\ncpu 20 0 20 160 0 0 0 0';
            if (cmd.includes('android.settings.SETTINGS')) {
                foreground = 'com.android.tv.settings/com.android.tv.settings.Main';
                return 'Status: ok';
            }
            if (cmd === 'input keyevent KEYCODE_HOME') {
                foreground = homeTarget;
                return '';
            }
            if (cmd === 'dumpsys activity activities') return `mResumedActivity: ActivityRecord{1 u0 ${foreground} t1}`;
            if (cmd.startsWith('am start')) return 'Status: ok';
            throw new Error(`Unexpected command: ${cmd}`);
        }),
        installApk: vi.fn(async () => 'Success'),
    };
    const snapshot = { createdAt: '2026-10-27T10:00:00Z', model: 'SHIELD' };
    const snapshots = {
        capture: vi.fn(async () => snapshot),
        plan: vi.fn(async () => ({
            user,
            model: 'SHIELD',
            createdAt: snapshot.createdAt,
            steps: [
                { kind: 'disable', target: 'com.nvidia.stats', from: 'enabled', to: 'disabled' },
                { kind: 'setting', target: 'hdmi_cec', from: '0', to: '1' },
            ],
            skipped: [],
        })),
        apply: vi.fn(async () => ({ steps: [], skipped: [] })),
    };
    const tweaks = {
        status: vi.fn(async () => ({ launcher: { home, launchers: [home, other], changed: true } })),
        change: vi.fn(async () => ({ success: true })),
    };
    const download = vi.fn(async () => new Response('invalid APK'));
    const service = () =>
        new TvMaintenance(
            adb,
            snapshots as unknown as DeviceSnapshot,
            tweaks as unknown as DeviceTweaks,
            root,
            download as typeof fetch,
        );
    return {
        service,
        adb,
        snapshots,
        tweaks,
        download,
        switchUser: () => {
            user = 10;
        },
        wrongHome: () => {
            homeTarget = other;
        },
    };
}
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tv-maintenance-'));
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
});

describe('TV maintenance', () => {
    it('diagnoses Google TV and persistent packages without mutating Android', async () => {
        const { service, adb } = setup();
        const status = await service().status('tv');
        expect(status.googleTv).toBe(true);
        expect(status.components.find((p) => p.packageName === 'com.home.app')?.persistent).toBe(true);
        expect(adb.shell.mock.calls.some(([, cmd]) => /disable|set-home|am start|keyevent/.test(cmd))).toBe(false);
    });
    it('persists a per-user baseline across service restarts, then repairs only selected differences', async () => {
        const { service, snapshots, switchUser } = setup();
        await service().action('tv', { action: 'save-baseline', user: 0 });
        const plan = (await service().action('tv', { action: 'check', user: 0 })) as { revision: string };
        expect(snapshots.apply).not.toHaveBeenCalled();
        await service().action('tv', {
            action: 'repair',
            user: 0,
            revision: plan.revision,
            selected: ['setting:hdmi_cec'],
        });
        expect(snapshots.apply).toHaveBeenCalledWith('tv', expect.anything(), 0, ['setting:hdmi_cec']);
        switchUser();
        await expect(service().action('tv', { action: 'check', user: 0 })).rejects.toThrow('user changed');
        await expect(service().action('tv', { action: 'check', user: 10 })).rejects.toThrow('Save a reference');
    });
    it('rejects stale references, unknown selections and missing user without writes', async () => {
        const { service, snapshots } = setup();
        await service().action('tv', { action: 'save-baseline', user: 0 });
        await expect(
            service().action('tv', { action: 'repair', user: 0, revision: 'old', selected: ['setting:hdmi_cec'] }),
        ).rejects.toThrow('Reference configuration changed');
        await expect(
            service().action('tv', {
                action: 'repair',
                user: 0,
                revision: '2026-10-27T10:00:00Z',
                selected: ['disable:com.evil.app'],
            }),
        ).rejects.toThrow('Device state changed');
        await expect(service().action('tv', { action: 'before' })).rejects.toThrow('user unavailable');
        expect(snapshots.apply).not.toHaveBeenCalled();
    });
    it('verifies an actual transition from Settings to Home', async () => {
        const { service, adb, tweaks } = setup();
        const result = await service().action('tv', { action: 'home-test', user: 0, expected: home });
        expect(result).toMatchObject({ success: true, actual: home, restored: false });
        expect(adb.shell.mock.calls.some(([, cmd]) => cmd.includes('android.settings.SETTINGS'))).toBe(true);
        expect(tweaks.change).not.toHaveBeenCalled();
    });
    it('restores only when explicitly requested after a failed Home test', async () => {
        vi.useFakeTimers();
        const { service, wrongHome, tweaks } = setup();
        wrongHome();
        const pending = service().action('tv', {
            action: 'home-test',
            user: 0,
            expected: home,
            restoreOnFailure: true,
        });
        await vi.runAllTimersAsync();
        expect(await pending).toMatchObject({ success: false, actual: other, restored: true });
        expect(tweaks.change).toHaveBeenCalledWith('tv', 'launcher', null);
    });
    it('reports reboot uncertainty and unavailable metrics instead of inventing gains', async () => {
        const { service, adb } = setup();
        await service().action('tv', { action: 'before', user: 0 });
        const original = adb.shell.getMockImplementation()!;
        adb.shell.mockImplementation(async (serial, cmd) =>
            cmd.includes('boot_id') || cmd.includes('meminfo') ? '' : original(serial, cmd),
        );
        expect(await service().action('tv', { action: 'after', user: 0 })).toMatchObject({
            sameBoot: false,
            availableDeltaKiB: null,
            after: { availableKiB: null, cpuPercent: 20, uptimeSeconds: 600 },
        });
    });
    it('rejects an altered APK before calling the installer and never uninstalls', async () => {
        const { service, download, adb } = setup();
        await expect(service().action('tv', { action: 'install-detox', user: 0 })).rejects.toThrow('checksum mismatch');
        expect(download).toHaveBeenCalledWith(DETOX.url, expect.anything());
        expect(adb.installApk).not.toHaveBeenCalled();
        expect(adb.shell.mock.calls.some(([, cmd]) => /uninstall|disable/.test(cmd))).toBe(false);
    });
    it('validates configuration and sends only quoted installed packages and allowlisted options', async () => {
        const { service, adb } = setup();
        await expect(
            service().action('tv', {
                action: 'configure-detox',
                user: 0,
                apps: ['com.x;reboot'],
                quick: [],
                clock: '24',
            }),
        ).rejects.toThrow('Invalid launcher');
        await expect(
            service().action('tv', {
                action: 'configure-detox',
                user: 0,
                apps: ['com.missing.app'],
                quick: [],
                clock: '24',
            }),
        ).rejects.toThrow('not installed');
        await service().action('tv', {
            action: 'configure-detox',
            user: 0,
            apps: ['com.home.app'],
            quick: ['sound'],
            clock: '24',
        });
        expect(adb.shell.mock.calls.at(-1)?.[1]).toContain(
            "--es apps 'com.home.app' --es quick 'sound' --es clock '24'",
        );
    });
    it('retains the operation lock until asynchronous configuration completes', async () => {
        const { service, adb } = setup();
        const original = adb.shell.getMockImplementation()!;
        let unblock!: () => void;
        const waiting = new Promise<void>((resolve) => {
            unblock = resolve;
        });
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        adb.shell.mockImplementation(async (serial, cmd) => {
            if (cmd.startsWith('am start')) {
                entered();
                await waiting;
            }
            return original(serial, cmd);
        });
        const maintenance = service();
        const pending = maintenance.action('tv', {
            action: 'configure-detox',
            user: 0,
            apps: [],
            quick: [],
            clock: 'auto',
        });
        await started;
        await expect(maintenance.action('tv', { action: 'before', user: 0 })).rejects.toThrow('already running');
        unblock();
        await pending;
        await expect(maintenance.action('tv', { action: 'before', user: 0 })).resolves.toHaveProperty('before');
    });
    it('parses persistent flags only inside the matching package block', () => {
        expect(
            persistentPackages(
                'Packages:\n  Package [com.a.app] (1):\n pkgFlags=[ SYSTEM ]\n  Package [com.b.app] (2):\n pkgFlags=[ PERSISTENT SYSTEM ]',
            ),
        ).toEqual(['com.b.app']);
    });
});
