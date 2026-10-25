import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';
import { shArg } from './security/deviceInput';
import { writeFileAtomicSync } from './util/atomicFile';

const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
export const OPT_COMMANDS = {
    user: 'am get-current-user',
    foreground: 'dumpsys activity activities',
    media: 'dumpsys media_session',
};
export interface OptimizationEntry {
    at: string;
    packageName: string;
    action: string;
    user: number;
    result: string;
}
interface Journal {
    protected: string[];
    history: OptimizationEntry[];
}
export class OptimizationError extends Error {}
const names = (output: string): string[] =>
    output.split(/\r?\n/).flatMap((line) => {
        const name = line.trim().replace(/^package:/, '');
        return PACKAGE.test(name) ? [name] : [];
    });
export function protectedPackages(home: string, foreground: string, media: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const match of home.matchAll(/\b([a-zA-Z][\w.]+)\/[\w.$]+/g)) result[match[1]!] = 'Active launcher';
    for (const line of foreground.split('\n')) {
        if (!/mResumedActivity|topResumedActivity/.test(line)) continue;
        const pkg = /\b([a-zA-Z][\w.]+)\/[\w.$]+/.exec(line)?.[1];
        if (pkg) result[pkg] = 'Foreground application';
    }
    // Protect all published sessions, including paused playback, not only state=3.
    for (const match of media.matchAll(/\b(?:package|packageName)=([a-zA-Z][\w.]+)/g))
        result[match[1]!] = 'Media session';
    return result;
}
export function appCategory(pkg: string): string {
    if (['com.nvidia.stats', 'com.nvidia.feedback', 'com.google.android.feedback'].includes(pkg))
        return 'Telemetry / feedback';
    if (pkg === 'com.nvidia.diagtools') return 'NVIDIA diagnostics';
    if (pkg === 'com.plexapp.mediaserver.smb') return 'Local Plex server';
    if (pkg === 'com.plexapp.android') return 'Plex player';
    return 'Application';
}
// Shield Controller's own conservative list. "recommended" is preselected in the wizard; "optional"
// is shown unticked because it removes a feature someone may use. Nothing else can be batch-disabled.
export const RECOMMENDATIONS: Record<string, 'recommended' | 'optional'> = {
    'com.nvidia.stats': 'recommended',
    'com.nvidia.feedback': 'recommended',
    'com.google.android.feedback': 'recommended',
    'com.nvidia.diagtools': 'optional',
    'com.google.android.tvrecommendations': 'optional',
    'com.plexapp.mediaserver.smb': 'optional',
    'com.amazon.music.tv': 'optional',
    'com.nvidia.bbciplayer': 'optional',
    'com.nvidia.bbciplayer.launch': 'optional',
    'com.nvidia.bbciplayer.launchsport': 'optional',
    'com.zattoo.player': 'optional',
    'air.ITVMobilePlayer': 'optional',
    'air.com.vudu.air.DownloaderTablet': 'optional',
};
export class DeviceOptimization {
    private readonly busy = new Set<string>();
    constructor(
        private readonly adb: Pick<AdbClient, 'shell'>,
        private readonly root: string,
    ) {}
    private path(serial: string, user: number): string {
        return join(this.root, `${createHash('sha256').update(serial).digest('hex')}-${user}.json`);
    }
    private read(serial: string, user: number): Journal {
        try {
            return JSON.parse(readFileSync(this.path(serial, user), 'utf8')) as Journal;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { protected: [], history: [] };
            throw error;
        }
    }
    private save(serial: string, user: number, journal: Journal): void {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        writeFileAtomicSync(this.path(serial, user), JSON.stringify(journal), { mode: 0o600 });
    }
    private async user(serial: string): Promise<number> {
        const value = (await this.adb.shell(serial, OPT_COMMANDS.user)).trim();
        if (!/^\d+$/.test(value)) throw new OptimizationError('Android user unavailable. Refresh diagnostics.');
        return Number(value);
    }
    async protection(serial: string, user: number) {
        const [home, foreground, media] = await Promise.all([
            this.adb
                .shell(
                    serial,
                    `cmd package resolve-activity --brief --user ${user} -a android.intent.action.MAIN -c android.intent.category.HOME`,
                )
                .catch(() => ''),
            this.adb.shell(serial, OPT_COMMANDS.foreground).catch(() => ''),
            this.adb.shell(serial, OPT_COMMANDS.media).catch(() => ''),
        ]);
        const protectedApps = protectedPackages(home, foreground, media);
        const reliable =
            /[\w.]+\/[\w.$]+/.test(home) &&
            !/ResolverActivity|ChooserActivity/.test(home) &&
            /ACTIVITY MANAGER ACTIVITIES/.test(foreground) &&
            /MEDIA SESSION SERVICE/.test(media) &&
            !/Permission Denial|Exception|Error:/.test(home + foreground + media);
        const journal = this.read(serial, user);
        for (const pkg of journal.protected) protectedApps[pkg] = 'Manual protection';
        return { protectedApps, reliable, journal };
    }
    async assertUnprotected(serial: string, pkg: string, user: number): Promise<void> {
        const protection = await this.protection(serial, user);
        if (!protection.reliable)
            throw new OptimizationError('Protection detection unavailable. Refresh diagnostics before disabling.');
        if (protection.protectedApps[pkg])
            throw new OptimizationError(`Protected application: ${protection.protectedApps[pkg]}`);
    }
    private async packages(serial: string, user: number, disabled = false, system = false): Promise<string[]> {
        const output = await this.adb.shell(
            serial,
            `pm list packages ${disabled ? '-d ' : system ? '-s ' : ''}--user ${user}`,
        );
        if (output.split(/\r?\n/).some((line) => line.trim() && !/^package:[a-zA-Z][\w.]+$/.test(line.trim())))
            throw new Error('Android package list unavailable.');
        const result = names(output);
        if (!disabled && !system && !result.length) throw new Error('Android package list unavailable.');
        return result;
    }
    async status(serial: string) {
        const user = await this.user(serial);
        const [installed, disabled, protection, processes, memory, storage, systems] = await Promise.all([
            this.packages(serial, user),
            this.packages(serial, user, true),
            this.protection(serial, user),
            this.adb.shell(serial, 'dumpsys cpuinfo').catch(() => 'Unavailable'),
            this.adb.shell(serial, 'cat /proc/meminfo').catch(() => 'Unavailable'),
            this.adb.shell(serial, 'df -k /data').catch(() => 'Unavailable'),
            this.packages(serial, user, false, true).catch(() => null),
        ]);
        const disabledNames = new Set(disabled);
        return {
            user,
            reliable: protection.reliable,
            processes,
            memory,
            storage,
            apps: installed.sort().map((packageName) => ({
                packageName,
                system: systems === null ? null : systems.includes(packageName),
                disabled: disabledNames.has(packageName),
                category: appCategory(packageName),
                protection: protection.protectedApps[packageName] ?? null,
                manual: protection.journal.protected.includes(packageName),
                recommendation: RECOMMENDATIONS[packageName] ?? null,
            })),
            history: protection.journal.history.slice(-200).reverse(),
        };
    }
    // Each package still goes through change(): protections, user check and verification apply one by one.
    async batchDisable(serial: string, packages: unknown, expectedUser: unknown) {
        if (
            !Array.isArray(packages) ||
            !packages.length ||
            packages.some((pkg) => typeof pkg !== 'string' || !(pkg in RECOMMENDATIONS))
        )
            throw new OptimizationError('Only applications from the recommendation list can be disabled in a batch.');
        const disabled: string[] = [];
        const failed: { packageName: string; error: string }[] = [];
        for (const pkg of new Set(packages as string[])) {
            try {
                await this.change(serial, pkg, 'disable', expectedUser);
                disabled.push(pkg);
            } catch (error) {
                failed.push({ packageName: pkg, error: error instanceof Error ? error.message : 'Failed' });
            }
        }
        return { disabled, failed };
    }
    // Undo only what this tool disabled: packages disabled by the firmware itself stay untouched.
    async restoreAll(serial: string, expectedUser: unknown) {
        const user = await this.user(serial);
        if (user !== expectedUser) throw new OptimizationError('Android user changed. Refresh diagnostics.');
        const last = new Map<string, string>();
        for (const entry of this.read(serial, user).history)
            if (entry.result === 'success' && (entry.action === 'disable' || entry.action === 'enable'))
                last.set(entry.packageName, entry.action);
        const disabled = new Set(await this.packages(serial, user, true));
        const enabled: string[] = [];
        const failed: { packageName: string; error: string }[] = [];
        for (const [pkg, action] of last) {
            if (action !== 'disable' || !disabled.has(pkg)) continue;
            try {
                await this.change(serial, pkg, 'enable', user);
                enabled.push(pkg);
            } catch (error) {
                failed.push({ packageName: pkg, error: error instanceof Error ? error.message : 'Failed' });
            }
        }
        return { enabled, failed };
    }
    async change(serial: string, pkg: unknown, action: unknown, expectedUser: unknown) {
        if (
            typeof pkg !== 'string' ||
            !PACKAGE.test(pkg) ||
            !['enable', 'disable', 'protect', 'unprotect'].includes(String(action))
        )
            throw new OptimizationError('Invalid optimization action.');
        if (this.busy.has(serial)) throw new OptimizationError('An optimization action is already running.');
        this.busy.add(serial);
        try {
            const user = await this.user(serial);
            if (user !== expectedUser) throw new OptimizationError('Android user changed. Refresh diagnostics.');
            const installed = await this.packages(serial, user);
            if (!installed.includes(pkg)) throw new OptimizationError('Application is not installed for this user.');
            const journal = this.read(serial, user);
            if (action === 'disable') await this.assertUnprotected(serial, pkg, user);
            const entry: OptimizationEntry = {
                at: new Date().toISOString(),
                packageName: pkg,
                action: String(action),
                user,
                result: 'pending',
            };
            journal.history.push(entry);
            journal.history = journal.history.slice(-200);
            this.save(serial, user, journal); // Record intent before touching Android; a crash leaves a visible pending entry.
            try {
                if (action === 'protect' || action === 'unprotect') {
                    journal.protected = journal.protected.filter((name) => name !== pkg);
                    if (action === 'protect') journal.protected.push(pkg);
                } else {
                    if ((await this.user(serial)) !== user)
                        throw new OptimizationError('Android user changed. Refresh diagnostics.');
                    const output = await this.adb.shell(
                        serial,
                        `pm ${action === 'disable' ? 'disable-user' : 'enable'} --user ${user} ${shArg(pkg)}`,
                    );
                    const expected = action === 'disable' ? 'disabled-user' : 'enabled';
                    if (!output.includes(`new state: ${expected}`))
                        throw new Error(output || 'Android refused the change.');
                    const disabled = await this.packages(serial, user, true);
                    if (disabled.includes(pkg) !== (action === 'disable'))
                        throw new Error('Android state verification failed.');
                }
                entry.result = 'success';
            } catch (error) {
                entry.result = error instanceof Error ? error.message : 'Failed';
                throw error;
            } finally {
                this.save(serial, user, journal);
            }
            return { success: true };
        } finally {
            this.busy.delete(serial);
        }
    }
}
