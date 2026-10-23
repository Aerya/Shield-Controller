import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceOptimization, protectedPackages } from '../DeviceOptimization';

let root: string;
let disabled: boolean;
let home: string;
let media: string;
let user: string;
let refuse: boolean;
const shell = vi.fn(async (_serial: string, command: string) => {
    if (command === 'am get-current-user') return user;
    if (command.includes('resolve-activity')) return home;
    if (command === 'dumpsys activity activities')
        return 'ACTIVITY MANAGER ACTIVITIES\nmResumedActivity: ActivityRecord{ com.foreground.app/.Main }';
    if (command === 'dumpsys media_session') return media;
    if (command.startsWith('pm list packages -d')) return disabled ? 'package:com.nvidia.stats' : '';
    if (command.startsWith('pm list packages'))
        return 'package:com.nvidia.stats\npackage:com.home.app\npackage:com.foreground.app\npackage:com.player.app';
    if (command.startsWith('pm disable-user')) {
        if (refuse) return 'SecurityException';
        disabled = true;
        return 'Package com.nvidia.stats new state: disabled-user';
    }
    if (command.startsWith('pm enable')) {
        disabled = false;
        return 'Package com.nvidia.stats new state: enabled';
    }
    return '';
});
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shield-optimization-'));
    disabled = false;
    home = 'com.home.app/.Home';
    media = 'MEDIA SESSION SERVICE\npackage=com.player.app\nactive=true';
    user = '0';
    refuse = false;
    shell.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const service = () => new DeviceOptimization({ shell }, root);
describe('reversible device optimization', () => {
    it('diagnoses without mutations and distinguishes telemetry', async () => {
        const result = await service().status('tv');
        expect(result.apps.find((app) => app.packageName === 'com.nvidia.stats')?.category).toBe(
            'Telemetry / feedback',
        );
        expect(result.reliable).toBe(true);
        expect(shell.mock.calls.some(([, command]) => /disable-user|pm enable|uninstall|pm clear/.test(command))).toBe(
            false,
        );
    });
    it('disables, verifies, persists across service restart and re-enables without deleting data', async () => {
        await service().change('tv', 'com.nvidia.stats', 'disable', 0);
        expect((await service().status('tv')).history[0]?.result).toBe('success');
        expect(disabled).toBe(true);
        await service().change('tv', 'com.nvidia.stats', 'enable', 0);
        expect(disabled).toBe(false);
        expect((await service().status('tv')).history).toHaveLength(2);
        expect((await service().status('other-tv')).history).toHaveLength(0);
        expect(shell.mock.calls.some(([, command]) => /uninstall|pm clear/.test(command))).toBe(false);
    });
    it.each(['com.home.app', 'com.foreground.app', 'com.player.app'])('protects %s at execution time', async (pkg) => {
        await expect(service().change('tv', pkg, 'disable', 0)).rejects.toThrow('Protected');
        expect(shell.mock.calls.some(([, command]) => command.startsWith('pm disable-user'))).toBe(false);
    });
    it('keeps manual protection across restart and allows removing it explicitly', async () => {
        await service().change('tv', 'com.nvidia.stats', 'protect', 0);
        await expect(service().change('tv', 'com.nvidia.stats', 'disable', 0)).rejects.toThrow('Protected');
        await service().change('tv', 'com.nvidia.stats', 'unprotect', 0);
        await service().change('tv', 'com.nvidia.stats', 'disable', 0);
        expect(disabled).toBe(true);
    });
    it('allows enabling with unavailable protection probes', async () => {
        home = '';
        media = '';
        disabled = true;
        await expect(service().change('tv', 'com.nvidia.stats', 'disable', 0)).rejects.toThrow('unavailable');
        await service().change('tv', 'com.nvidia.stats', 'enable', 0);
        expect(disabled).toBe(false);
    });
    it('journals Android failures without claiming success', async () => {
        refuse = true;
        await expect(service().change('tv', 'com.nvidia.stats', 'disable', 0)).rejects.toThrow('SecurityException');
        expect((await service().status('tv')).history[0]?.result).toBe('SecurityException');
    });
    it('rejects injection, missing packages, stale Android user and invalid actions', async () => {
        for (const [pkg, action] of [
            ['com.nvidia.stats; reboot', 'disable'],
            ['com.missing.app', 'disable'],
            ['com.nvidia.stats', 'clear'],
        ]) {
            await expect(service().change('tv', pkg, action, 0)).rejects.toThrow();
        }
        user = '10';
        await expect(service().change('tv', 'com.nvidia.stats', 'disable', 0)).rejects.toThrow('user changed');
        expect(shell.mock.calls.some(([, command]) => command.startsWith('pm disable-user'))).toBe(false);
    });
    it('serializes competing operations on one device', async () => {
        const instance = service();
        const first = instance.change('tv', 'com.nvidia.stats', 'disable', 0);
        await expect(instance.change('tv', 'com.nvidia.stats', 'disable', 0)).rejects.toThrow('already running');
        await first;
    });
    it('parses paused and background media sessions without confusing the Plex server with player', () => {
        expect(
            protectedPackages('com.home/.Main', '', 'package=com.plexapp.android\nstate=PlaybackState {state=2}'),
        ).toEqual({ 'com.home': 'Active launcher', 'com.plexapp.android': 'Media session' });
    });
});

it('does not treat the Android launcher chooser as an active launcher', async () => {
    home = 'android/com.android.internal.app.ResolverActivity';
    await expect(service().change('tv', 'com.home.app', 'disable', 0)).rejects.toThrow('unavailable');
});
it('does not report reactivation success when package verification fails', async () => {
    disabled = true;
    const implementation = shell.getMockImplementation()!;
    shell.mockImplementationOnce(implementation);
    const custom = {
        shell: vi.fn(async (serial: string, command: string) =>
            command.startsWith('pm list packages -d')
                ? 'Error: package service unavailable'
                : implementation(serial, command),
        ),
    };
    await expect(new DeviceOptimization(custom, root).change('tv', 'com.nvidia.stats', 'enable', 0)).rejects.toThrow(
        'package list unavailable',
    );
});
