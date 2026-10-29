import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CLEAN_LAUNCHER, installCleanLauncher, openCleanLauncher } from '../CleanLauncher';
import { benchmarkLauncher, frameSummary, launchTime } from '../TvBenchmark';
import { TV_COMPONENTS } from '../TvCompatibility';
import { auditPrivacy, microphoneEvidence } from '../TvPrivacy';
import { tvProfile } from '../TvProfiles';

describe('privacy evidence', () => {
    it('never treats shared system permissions or allowed modes as proof of recording', () => {
        expect(
            microphoneEvidence(
                'userId=1000\nrequested permissions:\nandroid.permission.RECORD_AUDIO',
                'RECORD_AUDIO: allow; time=+1s ago',
            ),
        ).toEqual({ sharedSystemUid: true, declared: null, accessed: null });
        expect(microphoneEvidence('', 'RECORD_AUDIO: allow; rejectTime=+1s ago').accessed).toBeNull();
        expect(microphoneEvidence('', 'RECORD_AUDIO: allow').accessed).toBeNull();
        expect(microphoneEvidence('', 'No operations.').accessed).toBe(false);
        expect(microphoneEvidence('', 'Error: denied').accessed).toBeNull();
        expect(microphoneEvidence('', 'RECORD_AUDIO: allow; time=+10s ago').accessed).toBe(true);
    });
    it('scopes commands to the user and rejects shell metacharacters from Android', async () => {
        const shell = vi.fn(async (_s: string, command: string) =>
            command.startsWith('pm list')
                ? 'package:com.nvidia.stats\npackage:com.voice.fake\npackage:com.voice.bad;reboot'
                : '',
        );
        const report = await auditPrivacy({ shell }, 'tv', 10);
        expect(report.entries).toHaveLength(2);
        expect(report.entries[1]?.category).toBe('unknown');
        expect(shell.mock.calls.every(([, c]) => !c.includes(';') && !/disable|am start|settings put/.test(c))).toBe(
            true,
        );
        expect(shell.mock.calls.some(([, c]) => c.includes('appops get --user 10'))).toBe(true);
    });
    it('fails on an unavailable package list rather than declaring a clean device', async () => {
        await expect(auditPrivacy({ shell: vi.fn(async () => 'Error') }, 'tv', 0)).rejects.toThrow(
            'package list unavailable',
        );
    });
});
describe('launcher benchmark', () => {
    it('does not invent a successful timing from missing or reused activity output', () => {
        expect(launchTime('Status: ok\nTotalTime: 45')).toBe(45);
        expect(launchTime('Status: timeout\nTotalTime: 45')).toBeNull();
        expect(launchTime('Warning: Activity not started\nStatus: ok\nTotalTime: 0')).toBeNull();
        expect(frameSummary('unavailable')).toEqual({ frames: null, janky: null });
    });
    it('measures the selected Home and reopens it after a cold-start error', async () => {
        const shell = vi.fn(async (_s: string, command: string) => {
            if (command === 'am get-current-user') return '10';
            if (command.includes('resolve-activity')) return 'com.home.app/.Main';
            if (command.includes('dumpsys activity')) return 'mResumedActivity: ActivityRecord{u10 com.home.app/.Main}';
            if (command.includes('gfxinfo')) return 'Total frames rendered: 12\nJanky frames: 2';
            if (command.includes('meminfo')) return 'TOTAL PSS: 1234';
            if (command.includes('-n')) throw new Error('start failed');
            return 'Status: ok\nTotalTime: 15';
        });
        await expect(benchmarkLauncher({ shell }, 'tv', 10)).rejects.toThrow('start failed');
        expect(shell.mock.calls.at(-1)?.[1]).toBe('input keyevent KEYCODE_HOME');
        expect(shell.mock.calls.some(([, c]) => c.startsWith('am force-stop --user 10'))).toBe(true);
    });
    it('refuses to touch another Android user', async () => {
        const shell = vi.fn(async () => '11');
        await expect(benchmarkLauncher({ shell }, 'tv', 10)).rejects.toThrow('user changed');
        expect(shell).toHaveBeenCalledTimes(1);
    });
});
describe('optional launcher', () => {
    it('ships exactly the APK whose hash is pinned', () => {
        const apk = readFileSync('assets/launchers/cleanyourtv.apk');
        expect(createHash('sha256').update(apk).digest('hex')).toBe(CLEAN_LAUNCHER.sha256);
        expect(apk.subarray(0, 2).toString()).toBe('PK');
    });
    it('installs only for user 0 and supported Android, preserves signature failures', async () => {
        const adb = {
            shell: vi.fn(async (_s: string, cmd: string) => (cmd.includes('sdk') ? '30' : '0')),
            installApk: vi.fn(async () => 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]'),
        };
        await expect(installCleanLauncher(adb, 'tv', 10)).rejects.toThrow('user 0');
        expect(adb.installApk).not.toHaveBeenCalled();
        await expect(installCleanLauncher(adb, 'tv', 0)).rejects.toThrow('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
        expect(adb.shell.mock.calls.every(([, c]) => !/uninstall|disable/.test(c))).toBe(true);
    });
    it('verifies the installed package and opens only the fixed component', async () => {
        const adb = {
            shell: vi.fn(async (_s: string, cmd: string) =>
                cmd.includes('sdk')
                    ? '30'
                    : cmd.includes('get-current-user')
                      ? '0'
                      : cmd.includes('pm list')
                        ? 'package:com.gathin.tvhome'
                        : 'Status: ok',
            ),
            installApk: vi.fn(async () => 'Success'),
        };
        await expect(installCleanLauncher(adb, 'tv', 0)).resolves.toMatchObject({ success: true });
        await openCleanLauncher(adb, 'tv', 10);
        expect(adb.shell.mock.calls.at(-1)?.[1]).toContain('am start --user 10 -W -n com.gathin.tvhome/.MainActivity');
    });
});
it('matches product identifiers without inventing a model and protects the remote dependency', () => {
    expect(tvProfile('NVIDIA', 'sif').model).toContain('tube');
    expect(tvProfile('NVIDIA', 'mdarcy').model).toContain('Pro 2019');
    expect(tvProfile('NVIDIA', 'darcy').model).toContain('2017');
    expect(tvProfile('Other', 'sif').model).toBeNull();
    expect(TV_COMPONENTS['com.google.android.tvrecommendations']).toBeTruthy();
});
