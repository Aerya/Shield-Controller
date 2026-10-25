import { describe, expect, it, vi } from 'vitest';
import type { DeviceOptimization } from '../DeviceOptimization';
import { DeviceSnapshot, SNAPSHOT_FORMAT, validateSnapshot } from '../DeviceSnapshot';
import type { DeviceTweaks } from '../DeviceTweaks';

const app = (packageName: string, disabled: boolean, protection: string | null = null) => ({
    packageName,
    disabled,
    protection,
});
function setup() {
    const calls: string[] = [];
    const optimization = {
        status: vi.fn(async () => ({
            user: 0,
            apps: [
                app('com.nvidia.stats', false),
                app('com.google.android.tvlauncher', false),
                app('com.old.disabled', true),
                app('com.player.app', false, 'Media session'),
            ],
        })),
        change: vi.fn(async (_serial: string, pkg: string, action: string) => {
            calls.push(`${action} ${pkg}`);
            if (pkg === 'com.google.android.tvlauncher') throw new Error('Protected application: Active launcher');
            return { success: true };
        }),
    };
    const tweaks = {
        status: vi.fn(async () => ({
            sdk: 30,
            tweaks: [
                { id: 'window_animation_scale', supported: true, value: '1' },
                { id: 'hdmi_cec', supported: true, value: '1' },
                { id: 'match_frame_rate', supported: false, value: null },
            ],
            density: { override: null },
            launcher: {
                home: 'com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity',
                launchers: [
                    'com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity',
                    'com.spocky.projengmenu/com.spocky.projengmenu.ui.home.MainActivity',
                ],
            },
        })),
        change: vi.fn(async (_serial: string, id: string, value: string) => {
            calls.push(`${id}=${value}`);
            return { success: true };
        }),
    };
    const adb = { shell: vi.fn(async () => 'SHIELD Android TV\n') };
    const service = new DeviceSnapshot(
        adb,
        optimization as unknown as DeviceOptimization,
        tweaks as unknown as DeviceTweaks,
    );
    return { service, calls };
}
const snapshot = (overrides: Record<string, unknown> = {}) => ({
    format: SNAPSHOT_FORMAT,
    version: 1,
    createdAt: '2026-10-25T00:00:00.000Z',
    model: 'SHIELD Android TV',
    sdk: 30,
    packages: {
        'com.nvidia.stats': 'disabled',
        'com.google.android.tvlauncher': 'disabled',
        'com.old.disabled': 'enabled',
        'com.player.app': 'disabled',
        'com.missing.app': 'disabled',
    },
    settings: { window_animation_scale: '0.5', hdmi_cec: null, match_frame_rate: '1' },
    density: 280,
    launcher: 'com.spocky.projengmenu/com.spocky.projengmenu.ui.home.MainActivity',
    ...overrides,
});

describe('device snapshots', () => {
    it('captures package states and supported settings', async () => {
        const result = await setup().service.capture('tv');
        expect(result.model).toBe('SHIELD Android TV');
        expect(result.packages['com.old.disabled']).toBe('disabled');
        expect(result.settings).toEqual({ window_animation_scale: '1', hdmi_cec: '1' });
        expect(validateSnapshot(JSON.parse(JSON.stringify(result)))).toBeTruthy();
    });
    it('plans only differences and reports what it skips', async () => {
        const { service, calls } = setup();
        const plan = await service.plan('tv', snapshot());
        expect(plan.steps.map((step) => `${step.kind} ${step.target}`)).toEqual([
            'disable com.nvidia.stats',
            'disable com.google.android.tvlauncher',
            'enable com.old.disabled',
            'setting window_animation_scale',
            'density density',
            'launcher launcher',
        ]);
        expect(plan.skipped.map((item) => item.target)).toEqual([
            'com.player.app',
            'com.missing.app',
            'hdmi_cec',
            'match_frame_rate',
        ]);
        expect(calls).toEqual([]);
    });
    it('applies the launcher first and records per-step failures', async () => {
        const { service, calls } = setup();
        const result = await service.apply('tv', snapshot(), 0);
        expect(calls[0]).toBe('launcher=com.spocky.projengmenu/com.spocky.projengmenu.ui.home.MainActivity');
        expect(calls.at(-1)).toMatch(/^disable /);
        expect(result.steps.find((step) => step.target === 'com.google.android.tvlauncher')?.result).toContain(
            'Protected',
        );
        expect(result.steps.find((step) => step.target === 'com.nvidia.stats')?.result).toBe('success');
        await expect(service.apply('tv', snapshot(), 10)).rejects.toThrow('user changed');
    });
    it('rejects foreign files, injection and out-of-list values', () => {
        for (const bad of [
            null,
            { format: 'other' },
            snapshot({ packages: { 'com.x; reboot': 'disabled' } }),
            snapshot({ packages: { 'com.x.y': 'uninstalled' } }),
            snapshot({ settings: { adb_enabled: '0' } }),
            snapshot({ settings: { hdmi_cec: "1'; reboot" } }),
            snapshot({ density: '280; reboot' }),
            snapshot({ launcher: 'not a component' }),
        ])
            expect(() => validateSnapshot(bad)).toThrow();
    });
});
