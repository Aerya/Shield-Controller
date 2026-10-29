import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';
import { CLEAN_LAUNCHER, installCleanLauncher, openCleanLauncher } from './CleanLauncher';
import { cpuUsage } from './DeviceMetrics';
import type { DeviceSnapshot, PlanStep, Snapshot } from './DeviceSnapshot';
import { components, type DeviceTweaks } from './DeviceTweaks';
import { shArg } from './security/deviceInput';
import { benchmarkLauncher } from './TvBenchmark';
import { persistentPackages, TV_COMPONENTS, TV_FEATURES } from './TvCompatibility';
import { auditPrivacy } from './TvPrivacy';
import { tvProfile } from './TvProfiles';
import { writeFileAtomicSync } from './util/atomicFile';

export const DETOX = {
    packageName: 'com.ansub.tvhome',
    component: 'com.ansub.tvhome/.MainActivity',
    version: '1.5.6',
    url: 'https://github.com/Ansub/tv-detox/releases/download/v1.5.6/tvhome.apk',
    sha256: '47eda1bdd497728481159a4088970014a1b6f3615f5776b04734c241075e1d7c',
};
const MAX_APK = 16 * 1024 * 1024;
const PACKAGE = /^[a-zA-Z][\w]*(?:\.[\w]+)+$/;
export class MaintenanceError extends Error {}
interface Measurement {
    at: string;
    bootId: string | null;
    uptimeSeconds: number | null;
    availableKiB: number | null;
    totalKiB: number | null;
    cpuPercent: number | null;
}
interface RecordData {
    baseline?: Snapshot;
    before?: Measurement;
    benchmark?: Awaited<ReturnType<typeof benchmarkLauncher>>;
}
export const stepId = (step: Pick<PlanStep, 'kind' | 'target'>): string => `${step.kind}:${step.target}`;
const expand = (component: string): string => component.replace(/\/\./, `/${component.split('/')[0]}.`);

export class TvMaintenance {
    private readonly busy = new Set<string>();
    constructor(
        private readonly adb: Pick<AdbClient, 'shell' | 'installApk'>,
        private readonly snapshots: DeviceSnapshot,
        private readonly tweaks: DeviceTweaks,
        private readonly root: string,
        private readonly download: typeof fetch = fetch,
    ) {}
    private async user(serial: string, expected?: unknown): Promise<number> {
        const raw = (await this.adb.shell(serial, 'am get-current-user')).trim();
        if (!/^\d+$/.test(raw)) throw new MaintenanceError('Android user unavailable. Refresh diagnostics.');
        const user = Number(raw);
        if (expected !== undefined && expected !== user)
            throw new MaintenanceError('Android user changed. Refresh diagnostics.');
        return user;
    }
    private path(serial: string, user: number): string {
        return join(this.root, `${createHash('sha256').update(serial).digest('hex')}-${user}.json`);
    }
    private read(serial: string, user: number): RecordData {
        try {
            return JSON.parse(readFileSync(this.path(serial, user), 'utf8')) as RecordData;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
            throw error;
        }
    }
    private save(serial: string, user: number, data: RecordData): void {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        writeFileAtomicSync(this.path(serial, user), JSON.stringify(data), { mode: 0o600 });
    }
    async status(serial: string) {
        const user = await this.user(serial);
        const record = this.read(serial, user);
        const [model, manufacturer, sdk, packages, dump, settings] = await Promise.all([
            this.adb.shell(serial, 'getprop ro.product.model'),
            this.adb.shell(serial, 'getprop ro.product.manufacturer'),
            this.adb.shell(serial, 'getprop ro.build.version.sdk'),
            this.adb.shell(serial, `pm list packages --user ${user}`),
            this.adb.shell(serial, 'dumpsys package').catch(() => ''),
            this.tweaks.status(serial),
        ]);
        await this.user(serial, user);
        const installed = packages
            .split(/\r?\n/)
            .map((p) => p.replace(/^package:/, '').trim())
            .filter((p) => PACKAGE.test(p));
        if (!installed.length) throw new MaintenanceError('Android package list unavailable.');
        const persistent = persistentPackages(dump).filter((pkg) => installed.includes(pkg));
        return {
            user,
            model: model.trim(),
            manufacturer: manufacturer.trim(),
            sdk: sdk.trim(),
            googleTv: installed.includes('com.google.android.apps.tv.launcherx'),
            home: settings.launcher.home,
            launchers: settings.launcher.launchers,
            flagsAvailable: /pkgFlags=\[/.test(dump),
            components: installed
                .filter((p) => TV_COMPONENTS[p] || TV_FEATURES[p] || persistent.includes(p))
                .map((pkg) => ({
                    packageName: pkg,
                    role: TV_COMPONENTS[pkg] ?? TV_FEATURES[pkg] ?? 'Persistent Android component',
                    protected: !!TV_COMPONENTS[pkg] || persistent.includes(pkg),
                    persistent: persistent.includes(pkg),
                })),
            baselineAt: record.baseline?.createdAt ?? null,
            before: record.before ?? null,
            profile: tvProfile(
                manufacturer.trim(),
                await this.adb.shell(serial, 'getprop ro.product.device').catch(() => ''),
            ),
            benchmark: record.benchmark ?? null,
            cleanLauncher: { ...CLEAN_LAUNCHER, installed: installed.includes(CLEAN_LAUNCHER.packageName) },
            detox: { ...DETOX, installed: installed.includes(DETOX.packageName) },
        };
    }
    // One maintenance operation per device; saving a baseline cannot race a repair.
    async action(serial: string, body: Record<string, unknown>) {
        if (this.busy.has(serial)) throw new MaintenanceError('A maintenance action is already running.');
        this.busy.add(serial);
        try {
            if (!Number.isInteger(body['user']))
                throw new MaintenanceError('Android user unavailable. Refresh diagnostics.');
            const user = await this.user(serial, body['user']);
            const record = this.read(serial, user);
            switch (body['action']) {
                case 'privacy': {
                    const report = await auditPrivacy(this.adb, serial, user);
                    await this.user(serial, user);
                    return report;
                }
                case 'benchmark': {
                    if (body['confirmed'] !== true) throw new MaintenanceError('Confirm the launcher benchmark first.');
                    const report = await benchmarkLauncher(this.adb, serial, user);
                    await this.user(serial, user);
                    this.save(serial, user, { ...record, benchmark: report });
                    return { before: record.benchmark ?? null, after: report };
                }
                case 'install-clean':
                    return await installCleanLauncher(this.adb, serial, user);
                case 'open-clean':
                    return await openCleanLauncher(this.adb, serial, user);
                case 'save-baseline': {
                    const baseline = await this.snapshots.capture(serial);
                    await this.user(serial, user);
                    this.save(serial, user, { ...record, baseline });
                    return { savedAt: baseline.createdAt };
                }
                case 'check':
                case 'repair': {
                    if (!record.baseline) throw new MaintenanceError('Save a reference configuration first.');
                    const plan = await this.snapshots.plan(serial, record.baseline);
                    if (plan.user !== user) throw new MaintenanceError('Android user changed. Refresh diagnostics.');
                    if (body['action'] === 'check') return { ...plan, revision: record.baseline.createdAt };
                    if (body['revision'] !== record.baseline.createdAt)
                        throw new MaintenanceError('Reference configuration changed. Check again.');
                    if (
                        !Array.isArray(body['selected']) ||
                        !body['selected'].length ||
                        body['selected'].some((id) => typeof id !== 'string')
                    )
                        throw new MaintenanceError('Select differences to restore.');
                    // Only the exact changes previewed by this browser may be repaired. New drift is not added.
                    const selected = new Set(body['selected'] as string[]);
                    if ([...selected].some((id) => !plan.steps.some((step) => stepId(step) === id)))
                        throw new MaintenanceError('Device state changed. Check again.');
                    return await this.snapshots.apply(serial, record.baseline, user, [...selected]);
                }
                case 'home-test':
                    return await this.testHome(serial, user, body['expected'], body['restoreOnFailure'] === true);
                case 'before': {
                    const before = await this.measure(serial);
                    await this.user(serial, user);
                    this.save(serial, user, { ...record, before });
                    return { before };
                }
                case 'after': {
                    if (!record.before) throw new MaintenanceError('Take a before measurement first.');
                    const after = await this.measure(serial);
                    await this.user(serial, user);
                    const before = record.before;
                    return {
                        before,
                        after,
                        sameBoot: before.bootId !== null && before.bootId === after.bootId,
                        availableDeltaKiB:
                            before.availableKiB !== null && after.availableKiB !== null
                                ? after.availableKiB - before.availableKiB
                                : null,
                    };
                }
                case 'install-detox':
                    if (user !== 0)
                        throw new MaintenanceError('Launcher installation is available for Android user 0 only.');
                    return await this.install(serial, user);
                case 'configure-detox':
                    return await this.configure(serial, user, body);
                default:
                    throw new MaintenanceError('Invalid maintenance action.');
            }
        } finally {
            this.busy.delete(serial);
        }
    }
    private async measure(serial: string): Promise<Measurement> {
        const read = (command: string) => this.adb.shell(serial, command).catch(() => '');
        const [memory, uptime, boot, cpu] = await Promise.all([
            read('cat /proc/meminfo'),
            read('cat /proc/uptime'),
            read('cat /proc/sys/kernel/random/boot_id'),
            read('head -n 1 /proc/stat; sleep 1; head -n 1 /proc/stat'),
        ]);
        const kib = (key: string) => {
            const value = new RegExp(`^${key}:\\s*(\\d+) kB`, 'm').exec(memory)?.[1];
            return value ? Number(value) : null;
        };
        const seconds = Number(uptime.trim().split(/\s+/)[0]);
        return {
            at: new Date().toISOString(),
            bootId: /^[\da-f-]{36}$/i.test(boot.trim()) ? boot.trim() : null,
            uptimeSeconds: uptime.trim() && Number.isFinite(seconds) ? seconds : null,
            availableKiB: kib('MemAvailable'),
            totalKiB: kib('MemTotal'),
            cpuPercent: cpuUsage(cpu),
        };
    }
    private async foreground(serial: string): Promise<string | null> {
        const dump = await this.adb.shell(serial, 'dumpsys activity activities');
        const line = dump.split('\n').find((line) => /topResumedActivity|mResumedActivity/.test(line));
        return line ? (components(line).map(expand).at(-1) ?? null) : null;
    }
    private async waitFor(serial: string, predicate: (front: string) => boolean): Promise<string | null> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const front = await this.foreground(serial);
            if (front && predicate(front)) return front;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return null;
    }
    private async testHome(serial: string, user: number, expected: unknown, restore: boolean) {
        const settings = await this.tweaks.status(serial);
        if (typeof expected !== 'string' || !settings.launcher.launchers.includes(expected))
            throw new MaintenanceError('Choose an installed launcher to test.');
        await this.user(serial, user);
        // Explicit UI action: prove we left Home before testing the Home key.
        const output = await this.adb.shell(serial, `am start --user ${user} -W -a android.settings.SETTINGS`);
        if (/Error|Exception/i.test(output)) throw new MaintenanceError('Could not open TV settings.');
        const away = await this.waitFor(
            serial,
            (front) =>
                /^(com.android.settings|com.android.tv.settings|com.tcl.settings|org.droidtv.settings)\//.test(front) &&
                front !== expected,
        );
        if (!away) throw new MaintenanceError('Could not verify the Settings screen. Home was not tested.');
        await this.user(serial, user);
        await this.adb.shell(serial, 'input keyevent KEYCODE_HOME');
        const actual = await this.waitFor(serial, (front) => front === expected);
        await this.user(serial, user);
        if (actual) return { success: true, expected, actual, restored: false };
        const observed = await this.foreground(serial);
        let restored = false;
        let restoreError: string | null = null;
        if (restore && settings.launcher.changed) {
            try {
                await this.tweaks.change(serial, 'launcher', null);
                restored = true;
            } catch (error) {
                restoreError = error instanceof Error ? error.message : 'Failed';
            }
        }
        return { success: false, expected, actual: observed, restored, restoreError };
    }
    private async install(serial: string, user: number) {
        const response = await this.download(DETOX.url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok || !response.body) throw new MaintenanceError('Launcher download failed.');
        const reader = response.body['getReader']();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_APK) throw new MaintenanceError('Launcher download exceeds the size limit.');
                chunks.push(value);
            }
        } finally {
            await reader.cancel();
        }
        const apk = Buffer.concat(chunks);
        if (createHash('sha256').update(apk).digest('hex') !== DETOX.sha256)
            throw new MaintenanceError('Launcher checksum mismatch. Nothing installed.');
        const dir = await mkdtemp(join(tmpdir(), 'shield-detox-'));
        try {
            const path = join(dir, 'tvhome.apk');
            await writeFile(path, apk, { mode: 0o600 });
            await this.user(serial, user);
            const output = await this.adb.installApk(serial, path);
            if (!/\bSuccess\b/.test(output)) throw new MaintenanceError(output || 'Android refused the APK.');
            const list = await this.adb.shell(serial, `pm list packages --user ${user} ${DETOX.packageName}`);
            if (!list.split(/\r?\n/).includes(`package:${DETOX.packageName}`))
                throw new MaintenanceError('Launcher installation could not be verified.');
            return { success: true, version: DETOX.version };
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
    private async configure(serial: string, user: number, body: Record<string, unknown>) {
        if (
            !Array.isArray(body['apps']) ||
            body['apps'].length > 100 ||
            body['apps'].some((p) => typeof p !== 'string' || !PACKAGE.test(p)) ||
            !Array.isArray(body['quick']) ||
            body['quick'].some((q) => !['bluetooth', 'sound', 'picture'].includes(String(q))) ||
            !['12', '24', 'auto'].includes(String(body['clock']))
        )
            throw new MaintenanceError('Invalid launcher configuration.');
        const list = await this.adb.shell(serial, `pm list packages --user ${user}`);
        const installed = new Set(list.split(/\r?\n/).map((line) => line.replace(/^package:/, '').trim()));
        if (!installed.has(DETOX.packageName) || body['apps'].some((p) => !installed.has(p as string)))
            throw new MaintenanceError('An application is not installed for this user.');
        await this.user(serial, user);
        const output = await this.adb.shell(
            serial,
            `am start --user ${user} -W -n ${DETOX.component} --es apps ${shArg(body['apps'].join(',') || 'auto')} --es quick ${shArg(body['quick'].join(',') || 'none')} --es clock ${shArg(String(body['clock']))} --es stamp ${shArg(String(Date.now()))}`,
        );
        if (/Error|Exception/i.test(output) || !/Status: ok/i.test(output))
            throw new MaintenanceError('Launcher did not accept the configuration command.');
        return { success: true };
    }
}
