import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, DeviceTweaks, parseDensity } from '../DeviceTweaks';

let root: string;
let sdk: string;
let settings: Map<string, string>;
let density: number | null;
let home: string;
let ignorePut: boolean;
const shell = vi.fn(async (_serial: string, command: string) => {
    if (command === 'getprop ro.build.version.sdk') return sdk;
    if (command === 'am get-current-user') return '0';
    let match = /^settings get (\w+) (\w+)$/.exec(command);
    if (match) return settings.get(`${match[1]}/${match[2]}`) ?? 'null';
    match = /^settings put (\w+) (\w+) '([^']*)'$/.exec(command);
    if (match) {
        if (!ignorePut) settings.set(`${match[1]}/${match[2]}`, match[3]!);
        return '';
    }
    match = /^settings delete (\w+) (\w+)$/.exec(command);
    if (match) {
        settings.delete(`${match[1]}/${match[2]}`);
        return 'Deleted 1 rows';
    }
    if (command === 'wm density')
        return `Physical density: 320${density === null ? '' : `\nOverride density: ${density}`}`;
    if (command === 'wm density reset') {
        density = null;
        return '';
    }
    match = /^wm density (\d+)$/.exec(command);
    if (match) {
        density = Number(match[1]);
        return '';
    }
    if (command.includes('resolve-activity')) return `priority=0\n${home}`;
    if (command.includes('query-activities'))
        return 'priority=0\n  com.google.android.tvlauncher/.MainActivity\npriority=0\n  com.spocky.projengmenu/.ui.home.MainActivity\n  com.android.tv.settings/.FallbackHome';
    const set = /^cmd package set-home-activity --user 0 '([^']+)'$/.exec(command);
    if (set) {
        home = set[1]!;
        return 'Success';
    }
    return '';
});
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shield-tweaks-'));
    sdk = '30';
    settings = new Map([['global/window_animation_scale', '1']]);
    density = null;
    home = 'com.google.android.tvlauncher/.MainActivity';
    ignorePut = false;
    shell.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const service = () => new DeviceTweaks({ shell }, root);

describe('device tweaks', () => {
    it('reads settings without changing anything and flags unsupported ones', async () => {
        const status = await service().status('tv');
        expect(status.tweaks.find((item) => item.id === 'window_animation_scale')?.value).toBe('1');
        expect(status.tweaks.find((item) => item.id === 'match_frame_rate')?.supported).toBe(false);
        expect(status.launcher.home).toBe('com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity');
        expect(status.launcher.launchers).toHaveLength(2);
        expect(shell.mock.calls.some(([, command]) => /settings put|wm density \d|set-home/.test(command))).toBe(false);
    });
    it('applies an allowlisted value and restores the original after a restart', async () => {
        await service().change('tv', 'window_animation_scale', '0.5');
        await service().change('tv', 'window_animation_scale', '0');
        expect(settings.get('global/window_animation_scale')).toBe('0');
        await service().change('tv', 'window_animation_scale', null);
        expect(settings.get('global/window_animation_scale')).toBe('1');
        expect(
            (await service().status('tv')).tweaks.find((item) => item.id === 'window_animation_scale')?.changed,
        ).toBe(false);
    });
    it('restores an unset setting by deleting it', async () => {
        await service().change('tv', 'hdmi_cec', '0');
        await service().change('tv', 'hdmi_cec', null);
        expect(settings.has('global/hdmi_control_enabled')).toBe(false);
    });
    it('rejects injection, unknown settings, unsupported Android versions and missing restores', async () => {
        await expect(service().change('tv', 'hdmi_cec', "1'; reboot")).rejects.toThrow('Invalid value');
        await expect(service().change('tv', 'adb_enabled', '0')).rejects.toThrow('Invalid setting');
        await expect(service().change('tv', 'match_frame_rate', '1')).rejects.toThrow('not available');
        await expect(service().change('tv', 'long_press', null)).rejects.toThrow('Nothing to restore');
        expect(shell.mock.calls.some(([, command]) => command.startsWith('settings put'))).toBe(false);
    });
    it('reports a setting that Android did not keep', async () => {
        ignorePut = true;
        await expect(service().change('tv', 'long_press', '1000')).rejects.toThrow('did not apply');
    });
    it('bounds display density and restores the physical value', async () => {
        await expect(service().change('tv', 'density', '20')).rejects.toThrow('between');
        await expect(service().change('tv', 'density', '300; reboot')).rejects.toThrow('between');
        await service().change('tv', 'density', '280');
        expect(density).toBe(280);
        await service().change('tv', 'density', null);
        expect(density).toBeNull();
    });
    it('switches only to an installed launcher and restores the previous one', async () => {
        await expect(service().change('tv', 'launcher', 'com.evil.app/.Main')).rejects.toThrow('not installed');
        await service().change('tv', 'launcher', 'com.spocky.projengmenu/com.spocky.projengmenu.ui.home.MainActivity');
        expect(home).toBe('com.spocky.projengmenu/com.spocky.projengmenu.ui.home.MainActivity');
        await service().change('tv', 'launcher', null);
        expect(home).toBe('com.google.android.tvlauncher/com.google.android.tvlauncher.MainActivity');
    });
    it('parses density and component output', () => {
        expect(parseDensity('Physical density: 320\nOverride density: 240')).toEqual({ physical: 320, override: 240 });
        expect(components('a\n com.x.y/.Main\n com.x.y/.Main')).toEqual(['com.x.y/.Main']);
    });
});
