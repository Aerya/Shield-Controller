import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';
import { shArg } from './security/deviceInput';
import { writeFileAtomicSync } from './util/atomicFile';

// Each tweak is a documented Android setting with an allowlist of values: browser input never
// reaches the device shell unless it matches one of these values exactly.
export interface SettingTweak {
    id: string;
    namespace: 'global' | 'secure';
    key: string;
    values: string[];
    minSdk: number;
}
export const SETTING_TWEAKS: SettingTweak[] = [
    { id: 'hdmi_cec', namespace: 'global', key: 'hdmi_control_enabled', values: ['0', '1'], minSdk: 21 },
    {
        id: 'cec_auto_wakeup',
        namespace: 'global',
        key: 'hdmi_control_auto_wakeup_enabled',
        values: ['0', '1'],
        minSdk: 21,
    },
    {
        id: 'cec_auto_off',
        namespace: 'global',
        key: 'hdmi_control_auto_device_off_enabled',
        values: ['0', '1'],
        minSdk: 21,
    },
    {
        id: 'match_frame_rate',
        namespace: 'secure',
        key: 'match_content_frame_rate',
        values: ['0', '1', '2'],
        minSdk: 31,
    },
    { id: 'long_press', namespace: 'secure', key: 'long_press_timeout', values: ['400', '1000', '1500'], minSdk: 21 },
    ...(['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'] as const).map((key) => ({
        id: key,
        namespace: 'global' as const,
        key,
        values: ['0', '0.5', '1', '1.5', '2'],
        minSdk: 21,
    })),
    { id: 'surround', namespace: 'global', key: 'encoded_surround_output', values: ['0', '1', '2', '3'], minSdk: 28 },
];
export const DENSITY = { min: 160, max: 640 };
const COMPONENT = /^[a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+$/;
const HOME_INTENT = '-a android.intent.action.MAIN -c android.intent.category.HOME';

interface Journal {
    // First value seen before Shield Controller changed it; null means "unset" (Android default).
    originals: Record<string, string | null>;
}
export class TweakError extends Error {}

export const components = (output: string): string[] => [
    ...new Set([...output.matchAll(/\b([a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+)/g)].map((match) => match[1]!)),
];
// `resolve-activity` prints the short form (pkg/.Main); `query-activities` may print either.
const expand = (component: string): string => {
    const [pkg, activity] = component.split('/') as [string, string];
    return activity.startsWith('.') ? `${pkg}/${pkg}${activity}` : component;
};
export function parseDensity(output: string): { physical: number | null; override: number | null } {
    const read = (label: string) => {
        const value = new RegExp(`${label} density:\\s*(\\d+)`).exec(output)?.[1];
        return value ? Number(value) : null;
    };
    return { physical: read('Physical'), override: read('Override') };
}

export class DeviceTweaks {
    private readonly busy = new Set<string>();
    constructor(
        private readonly adb: Pick<AdbClient, 'shell'>,
        private readonly root: string,
    ) {}
    private path(serial: string): string {
        return join(this.root, `${createHash('sha256').update(serial).digest('hex')}.json`);
    }
    private read(serial: string): Journal {
        try {
            return JSON.parse(readFileSync(this.path(serial), 'utf8')) as Journal;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { originals: {} };
            throw error;
        }
    }
    private save(serial: string, journal: Journal): void {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        writeFileAtomicSync(this.path(serial), JSON.stringify(journal), { mode: 0o600 });
    }
    private async sdk(serial: string): Promise<number> {
        const value = (await this.adb.shell(serial, 'getprop ro.build.version.sdk')).trim();
        if (!/^\d+$/.test(value)) throw new TweakError('Android version unavailable. Refresh the panel.');
        return Number(value);
    }
    private async user(serial: string): Promise<number> {
        const value = (await this.adb.shell(serial, 'am get-current-user')).trim();
        if (!/^\d+$/.test(value)) throw new TweakError('Android user unavailable. Refresh diagnostics.');
        return Number(value);
    }
    private async setting(serial: string, tweak: SettingTweak): Promise<string | null> {
        const value = (await this.adb.shell(serial, `settings get ${tweak.namespace} ${tweak.key}`)).trim();
        return value === 'null' || value === '' ? null : value;
    }
    private async home(serial: string, user: number): Promise<string | null> {
        const output = await this.adb.shell(
            serial,
            `cmd package resolve-activity --brief --user ${user} ${HOME_INTENT}`,
        );
        if (/ResolverActivity|ChooserActivity/.test(output)) return null;
        const found = components(output).at(-1);
        return found ? expand(found) : null;
    }
    private async launchers(serial: string, user: number): Promise<string[]> {
        const output = await this.adb.shell(
            serial,
            `cmd package query-activities --brief --user ${user} ${HOME_INTENT}`,
        );
        return components(output)
            .map(expand)
            .filter((component) => !/FallbackHome|ResolverActivity/.test(component));
    }

    async status(serial: string) {
        const [sdk, user] = await Promise.all([this.sdk(serial), this.user(serial)]);
        const journal = this.read(serial);
        const tweaks = await Promise.all(
            SETTING_TWEAKS.map(async (tweak) => {
                const supported = sdk >= tweak.minSdk;
                return {
                    id: tweak.id,
                    values: tweak.values,
                    supported,
                    value: supported ? await this.setting(serial, tweak).catch(() => null) : null,
                    changed: tweak.id in journal.originals,
                    original: journal.originals[tweak.id] ?? null,
                };
            }),
        );
        const [density, home, launchers] = await Promise.all([
            this.adb
                .shell(serial, 'wm density')
                .then(parseDensity)
                .catch(() => ({ physical: null, override: null })),
            this.home(serial, user).catch(() => null),
            this.launchers(serial, user).catch((): string[] => []),
        ]);
        return {
            sdk,
            user,
            tweaks,
            density: { ...density, ...DENSITY, changed: 'density' in journal.originals },
            launcher: { home, launchers, changed: 'launcher' in journal.originals },
        };
    }

    async change(serial: string, id: unknown, value: unknown) {
        if (typeof id !== 'string' || (value !== null && typeof value !== 'string'))
            throw new TweakError('Invalid setting.');
        if (this.busy.has(serial)) throw new TweakError('A setting change is already running on this device.');
        this.busy.add(serial);
        try {
            const journal = this.read(serial);
            const restore = value === null;
            if (restore && !(id in journal.originals)) throw new TweakError('Nothing to restore for this setting.');
            const target = restore ? journal.originals[id]! : value;
            if (id === 'density') await this.density(serial, journal, target, restore);
            else if (id === 'launcher') await this.launcher(serial, journal, target, restore);
            else await this.applySetting(serial, journal, id, target, restore);
            if (restore) delete journal.originals[id];
            this.save(serial, journal);
            return { success: true };
        } finally {
            this.busy.delete(serial);
        }
    }

    private async applySetting(
        serial: string,
        journal: Journal,
        id: string,
        value: string | null,
        restore: boolean,
    ): Promise<void> {
        const tweak = SETTING_TWEAKS.find((item) => item.id === id);
        if (!tweak) throw new TweakError('Invalid setting.');
        // Restoring may write back any value Android had before, but only the allowlist on change.
        if (!restore && !tweak.values.includes(value ?? '')) throw new TweakError('Invalid value for this setting.');
        if (restore && value !== null && !/^[\w.-]{1,32}$/.test(value)) throw new TweakError('Invalid saved value.');
        if ((await this.sdk(serial)) < tweak.minSdk)
            throw new TweakError('This setting is not available on this Android version.');
        const before = await this.setting(serial, tweak);
        if (!restore && !(id in journal.originals)) {
            journal.originals[id] = before;
            this.save(serial, journal); // Keep the original even if the device drops mid-change.
        }
        await this.adb.shell(
            serial,
            value === null
                ? `settings delete ${tweak.namespace} ${tweak.key}`
                : `settings put ${tweak.namespace} ${tweak.key} ${shArg(value)}`,
        );
        if ((await this.setting(serial, tweak)) !== value) throw new Error('Android did not apply the setting.');
    }

    private async density(serial: string, journal: Journal, value: string | null, restore: boolean): Promise<void> {
        const reset = value === null || value === 'reset';
        const number = Number(value);
        if (!reset && !(Number.isInteger(number) && number >= DENSITY.min && number <= DENSITY.max))
            throw new TweakError(`Density must be between ${DENSITY.min} and ${DENSITY.max}.`);
        const before = parseDensity(await this.adb.shell(serial, 'wm density'));
        if (!restore && !('density' in journal.originals)) {
            journal.originals['density'] = before.override === null ? null : String(before.override);
            this.save(serial, journal);
        }
        await this.adb.shell(serial, reset ? 'wm density reset' : `wm density ${number}`);
        const after = parseDensity(await this.adb.shell(serial, 'wm density'));
        if (reset ? after.override !== null && after.override !== after.physical : after.override !== number)
            throw new Error('Android did not apply the display density.');
    }

    private async launcher(serial: string, journal: Journal, value: string | null, restore: boolean): Promise<void> {
        if (value === null || !COMPONENT.test(value)) throw new TweakError('Invalid launcher.');
        const user = await this.user(serial);
        if (!(await this.launchers(serial, user)).includes(value))
            throw new TweakError('This launcher is not installed or not enabled for this user.');
        const before = await this.home(serial, user);
        if (!restore && !('launcher' in journal.originals)) {
            if (!before) throw new TweakError('Current launcher unavailable. Refresh before changing it.');
            journal.originals['launcher'] = before;
            this.save(serial, journal);
        }
        const output = await this.adb.shell(serial, `cmd package set-home-activity --user ${user} ${shArg(value)}`);
        if (/Error|Exception|Unknown command/i.test(output)) throw new Error(output.trim());
        if ((await this.home(serial, user)) !== value) throw new Error('Android did not change the launcher.');
    }
}
