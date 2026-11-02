import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';
import { setRemoteAccessibility } from './RemoteAccessibility';
import { shArg } from './security/deviceInput';

export const REMOTE = {
    packageName: 'org.shieldcontroller.remote',
    version: 1,
    appVersion: 2,
    versionName: '1.1',
    minSdk: 26,
    sha256: '32cdcfead383bf92a1beb3de1f4b7443fafd0e0cb192f3ccecbfb52eac0c45f0',
};
export const REMOTE_KEYS = [
    3, 4, 82, 84, 85, 86, 87, 88, 89, 90, 126, 127, 172, 183, 184, 185, 186, 187, 188, 189, 190,
];
export interface RemoteBinding {
    key: number;
    tap: string;
    hold: string | null;
    double: string | null;
}
export function validateBindings(raw: unknown): RemoteBinding[] {
    if (!Array.isArray(raw) || raw.length > 20) throw new Error('Invalid remote configuration.');
    const seen = new Set<number>();
    const action = (v: unknown, required = false): string | null => {
        if (v == null && !required) return null;
        if (
            typeof v !== 'string' ||
            v.length > 200 ||
            (!['home', 'back', 'recents', 'notifications', 'none'].includes(v) &&
                !/^app:[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(v))
        )
            throw new Error('Invalid remote action.');
        return v;
    };
    return raw.map((row) => {
        if (!row || typeof row !== 'object' || !REMOTE_KEYS.includes(row.key) || seen.has(row.key))
            throw new Error('Unsupported or duplicate remote button.');
        seen.add(row.key);
        return { key: row.key, tap: action(row.tap, true)!, hold: action(row.hold), double: action(row.double) };
    });
}
export class RemoteMapping {
    constructor(private readonly adb: Pick<AdbClient, 'shell' | 'installApk'>) {}
    private async checkUser(serial: string, user: number) {
        if ((await this.adb.shell(serial, 'am get-current-user')).trim() !== String(user))
            throw new Error('Android user changed. Refresh diagnostics.');
    }
    private async call(serial: string, user: number, bindings?: RemoteBinding[]) {
        await this.checkUser(serial, user);
        const arg = bindings ? ` --arg ${shArg(Buffer.from(JSON.stringify(bindings)).toString('base64'))}` : '';
        const output = await this.adb.shell(
            serial,
            `content call --user ${user} --uri content://${REMOTE.packageName} --method ${bindings ? 'set' : 'status'}${arg}`,
        );
        const payload = /payload=([A-Za-z0-9+/=]+)/.exec(output)?.[1];
        if (!payload) throw new Error('Remote companion unavailable. Install it and open its setup on the TV.');
        const state = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        if (state.version !== REMOTE.version || typeof state.active !== 'boolean' || !Array.isArray(state.apps))
            throw new Error('Unsupported remote companion version.');
        state.bindings = validateBindings(state.bindings);
        await this.checkUser(serial, user);
        return state;
    }
    async status(serial: string, user: number) {
        const packages = await this.adb.shell(serial, `pm list packages --user ${user} ${REMOTE.packageName}`);
        const installed = packages.split(/\r?\n/).includes(`package:${REMOTE.packageName}`);
        await this.checkUser(serial, user);
        if (!installed) return { installed: false, active: false, bindings: [], apps: [] };
        return { ...(await this.call(serial, user)), installed: true };
    }
    async save(serial: string, user: number, raw: unknown) {
        const bindings = validateBindings(raw);
        // Re-read installed launchable apps, so stale browser selections never execute arbitrary intents.
        const before = await this.call(serial, user);
        for (const row of bindings)
            for (const action of [row.tap, row.hold, row.double]) {
                if (
                    action?.startsWith('app:') &&
                    !before.apps.some((app: { packageName: string }) => app.packageName === action.slice(4))
                )
                    throw new Error('Selected application is unavailable. Refresh remote configuration.');
            }
        const result = await this.call(serial, user, bindings);
        if (JSON.stringify(result.bindings) !== JSON.stringify(bindings))
            throw new Error('Remote configuration could not be verified.');
        return { ...result, installed: true };
    }
    async install(serial: string, user: number) {
        if (user !== 0) throw new Error('Installation requires Android 8+ and Android user 0.');
        const sdk = (await this.adb.shell(serial, 'getprop ro.build.version.sdk')).trim();
        if (!/^\d+$/.test(sdk) || Number(sdk) < REMOTE.minSdk)
            throw new Error('Installation requires Android 8+ and Android user 0.');
        const path = join(process.cwd(), 'assets', 'launchers', 'shield-remote.apk');
        const apk = await readFile(path);
        if (createHash('sha256').update(apk).digest('hex') !== REMOTE.sha256)
            throw new Error('Remote companion checksum mismatch.');
        await this.checkUser(serial, user);
        const result = await this.adb.installApk(serial, path);
        if (!/\bSuccess\b/.test(result)) throw new Error(result || 'Android refused the APK.');
        return await this.status(serial, user);
    }
    async accessibility(serial: string, user: number, enabled: unknown, confirmed: unknown) {
        if (typeof enabled !== 'boolean' || confirmed !== true)
            throw new Error('Confirm remote accessibility changes first.');
        const before = await this.call(serial, user);
        if (before.appVersion !== REMOTE.appVersion || before.registered !== true)
            throw new Error('Update the remote companion before changing accessibility.');
        await setRemoteAccessibility(this.adb, serial, user, enabled);
        let state = await this.call(serial, user);
        for (let attempt = 0; attempt < 8 && (state.active !== enabled || state.enabled !== enabled); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            state = await this.call(serial, user);
        }
        return { ...state, installed: true };
    }
    async open(serial: string, user: number, native: boolean) {
        await this.checkUser(serial, user);
        // NVIDIA exposes its menu-button UI through firmware-specific activities. Use the public
        // accessories intent when resolvable; never guess a private component or write vendor settings.
        let intent = '-a android.settings.BLUETOOTH_SETTINGS';
        if (native) {
            const manufacturer = (await this.adb.shell(serial, 'getprop ro.product.manufacturer')).trim();
            if (!/^nvidia$/i.test(manufacturer)) throw new Error('Native remote settings require an NVIDIA Shield.');
        } else intent = `-n ${REMOTE.packageName}/.SetupActivity`;
        await this.checkUser(serial, user);
        const out = await this.adb.shell(serial, `am start --user ${user} -W ${intent}`);
        if (!/^Status: ok\s*$/m.test(out) || /Error|Exception/i.test(out))
            throw new Error('Could not open TV settings.');
        return { success: true };
    }
}
