import type { AdbClient } from './AdbClient';
import type { DeviceOptimization } from './DeviceOptimization';
import { DENSITY, type DeviceTweaks, SETTING_TWEAKS } from './DeviceTweaks';

export const SNAPSHOT_FORMAT = 'shield-controller-snapshot';
const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
const COMPONENT = /^[a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+$/;
const MAX_PACKAGES = 5000;

export interface Snapshot {
    format: typeof SNAPSHOT_FORMAT;
    version: 1;
    createdAt: string;
    model: string;
    sdk: number;
    packages: Record<string, 'enabled' | 'disabled'>;
    settings: Record<string, string | null>;
    density: number | null;
    launcher: string | null;
}
export interface PlanStep {
    kind: 'enable' | 'disable' | 'setting' | 'density' | 'launcher';
    target: string;
    from: string | null;
    to: string;
    result?: string;
}
export class SnapshotError extends Error {}

export function validateSnapshot(value: unknown): Snapshot {
    const snapshot = value as Snapshot;
    if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        snapshot.format !== SNAPSHOT_FORMAT ||
        snapshot.version !== 1 ||
        !snapshot.packages ||
        typeof snapshot.packages !== 'object' ||
        !snapshot.settings ||
        typeof snapshot.settings !== 'object'
    )
        throw new SnapshotError('Not a Shield Controller snapshot.');
    const packages = Object.entries(snapshot.packages);
    if (
        packages.length > MAX_PACKAGES ||
        packages.some(([pkg, state]) => !PACKAGE.test(pkg) || (state !== 'enabled' && state !== 'disabled'))
    )
        throw new SnapshotError('Invalid application list in snapshot.');
    for (const [id, setting] of Object.entries(snapshot.settings)) {
        const tweak = SETTING_TWEAKS.find((item) => item.id === id);
        if (!tweak || (setting !== null && !tweak.values.includes(setting)))
            throw new SnapshotError('Invalid setting in snapshot.');
    }
    if (
        snapshot.density !== null &&
        !(Number.isInteger(snapshot.density) && snapshot.density >= DENSITY.min && snapshot.density <= DENSITY.max)
    )
        throw new SnapshotError('Invalid density in snapshot.');
    if (snapshot.launcher !== null && (typeof snapshot.launcher !== 'string' || !COMPONENT.test(snapshot.launcher)))
        throw new SnapshotError('Invalid launcher in snapshot.');
    return snapshot;
}

export class DeviceSnapshot {
    private readonly busy = new Set<string>();
    constructor(
        private readonly adb: Pick<AdbClient, 'shell'>,
        private readonly optimization: DeviceOptimization,
        private readonly tweaks: DeviceTweaks,
    ) {}

    async capture(serial: string): Promise<Snapshot> {
        const [apps, settings, model] = await Promise.all([
            this.optimization.status(serial),
            this.tweaks.status(serial),
            this.adb.shell(serial, 'getprop ro.product.model').catch(() => ''),
        ]);
        return {
            format: SNAPSHOT_FORMAT,
            version: 1,
            createdAt: new Date().toISOString(),
            model: model.trim(),
            sdk: settings.sdk,
            packages: Object.fromEntries(
                apps.apps.map((app) => [app.packageName, app.disabled ? 'disabled' : 'enabled'] as const),
            ),
            settings: Object.fromEntries(
                settings.tweaks.filter((tweak) => tweak.supported).map((tweak) => [tweak.id, tweak.value]),
            ),
            density: settings.density.override,
            launcher: settings.launcher.home,
        };
    }

    // Only differences are planned. Packages missing on this device, unsupported settings and
    // "Android default" values are skipped and reported, never guessed.
    async plan(serial: string, input: unknown) {
        const snapshot = validateSnapshot(input);
        const [apps, settings] = await Promise.all([this.optimization.status(serial), this.tweaks.status(serial)]);
        const steps: PlanStep[] = [];
        const skipped: { target: string; reason: string }[] = [];
        const current = new Map(apps.apps.map((app) => [app.packageName, app]));
        // The current launcher stops being protected once the snapshot's launcher is set; change()
        // re-checks every protection at execution time anyway.
        const switching =
            !!snapshot.launcher &&
            snapshot.launcher !== settings.launcher.home &&
            settings.launcher.launchers.includes(snapshot.launcher);
        for (const [pkg, state] of Object.entries(snapshot.packages)) {
            const app = current.get(pkg);
            if (!app) {
                if (state === 'disabled') skipped.push({ target: pkg, reason: 'Not installed on this device' });
                continue;
            }
            if (app.disabled === (state === 'disabled')) continue;
            if (state === 'disabled' && app.protection && !(switching && app.protection === 'Active launcher')) {
                skipped.push({ target: pkg, reason: app.protection });
                continue;
            }
            steps.push({ kind: state === 'disabled' ? 'disable' : 'enable', target: pkg, from: null, to: state });
        }
        for (const [id, value] of Object.entries(snapshot.settings)) {
            const tweak = settings.tweaks.find((item) => item.id === id);
            if (!tweak?.supported) skipped.push({ target: id, reason: 'Not available on this Android version.' });
            else if (value === null) {
                if (tweak.value !== null) skipped.push({ target: id, reason: 'Android default' });
            } else if (tweak.value !== value) steps.push({ kind: 'setting', target: id, from: tweak.value, to: value });
        }
        if (snapshot.density !== settings.density.override)
            steps.push({
                kind: 'density',
                target: 'density',
                from: settings.density.override === null ? null : String(settings.density.override),
                to: snapshot.density === null ? 'reset' : String(snapshot.density),
            });
        if (snapshot.launcher && snapshot.launcher !== settings.launcher.home) {
            if (settings.launcher.launchers.includes(snapshot.launcher))
                steps.push({
                    kind: 'launcher',
                    target: 'launcher',
                    from: settings.launcher.home,
                    to: snapshot.launcher,
                });
            else skipped.push({ target: snapshot.launcher, reason: 'Not installed on this device' });
        }
        return { user: apps.user, model: snapshot.model, createdAt: snapshot.createdAt, steps, skipped };
    }

    async apply(serial: string, input: unknown, expectedUser: unknown) {
        if (this.busy.has(serial)) throw new SnapshotError('A snapshot is already being applied to this device.');
        this.busy.add(serial);
        try {
            const plan = await this.plan(serial, input);
            if (plan.user !== expectedUser) throw new SnapshotError('Android user changed. Refresh diagnostics.');
            // Launcher first, so the old launcher is no longer protected if the snapshot disables it.
            const order = ['launcher', 'enable', 'setting', 'density', 'disable'];
            plan.steps.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
            for (const step of plan.steps) {
                try {
                    if (step.kind === 'enable' || step.kind === 'disable')
                        await this.optimization.change(serial, step.target, step.kind, plan.user);
                    else await this.tweaks.change(serial, step.target, step.to);
                    step.result = 'success';
                } catch (error) {
                    step.result = error instanceof Error ? error.message : 'Failed';
                }
            }
            return plan;
        } finally {
            this.busy.delete(serial);
        }
    }
}
