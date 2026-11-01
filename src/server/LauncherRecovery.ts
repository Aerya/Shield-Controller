import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';
import { components } from './DeviceTweaks';
import { shArg } from './security/deviceInput';
import { persistentPackages, TV_COMPONENTS } from './TvCompatibility';
import { writeFileAtomicSync } from './util/atomicFile';

const STOCK = ['com.google.android.tvlauncher', 'com.google.android.apps.tv.launcherx'];
const HOME = '-a android.intent.action.MAIN -c android.intent.category.HOME';
const expand = (s: string) => s.replace(/\/\./, `/${s.split('/')[0]}.`);
interface Recovery {
    stock: string;
    previous: string;
    target: string;
    enabled: number;
}
export class LauncherRecovery {
    constructor(
        private readonly adb: Pick<AdbClient, 'shell'>,
        private readonly root: string,
    ) {}
    private path(serial: string, user: number) {
        return join(this.root, `${createHash('sha256').update(serial).digest('hex')}-${user}-launcher.json`);
    }
    saved(serial: string, user: number): Recovery | null {
        try {
            return JSON.parse(readFileSync(this.path(serial, user), 'utf8'));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
        }
    }
    private async checkUser(serial: string, user: number) {
        if ((await this.adb.shell(serial, 'am get-current-user')).trim() !== String(user))
            throw new Error('Android user changed. Refresh diagnostics.');
    }
    private async home(serial: string, user: number) {
        const out = await this.adb.shell(serial, `cmd package resolve-activity --brief --user ${user} ${HOME}`);
        if (/ResolverActivity|ChooserActivity|FallbackHome/.test(out)) return null;
        return components(out).map(expand).at(-1) ?? null;
    }
    async diagnose(serial: string, user: number) {
        const launchers = components(
            await this.adb.shell(serial, `cmd package query-activities --brief --user ${user} ${HOME}`),
        ).map(expand);
        const home = await this.home(serial, user);
        const packageDump = await this.adb.shell(serial, 'dumpsys package');
        const persistent = persistentPackages(packageDump);
        await this.checkUser(serial, user);
        return {
            home,
            launchers,
            candidates: STOCK.filter(
                (pkg) =>
                    launchers.some((c) => c.startsWith(`${pkg}/`)) &&
                    !persistent.includes(pkg) &&
                    /pkgFlags=\[/.test(packageDump),
            ),
            recovery: this.saved(serial, user),
        };
    }
    private async opened(serial: string, user: number, target: string) {
        for (let n = 0; n < 6; n++) {
            await this.checkUser(serial, user);
            const dump = await this.adb.shell(serial, 'dumpsys activity activities');
            const line = dump.split('\n').find((l) => /topResumedActivity|mResumedActivity/.test(l));
            if (line && components(line).map(expand).includes(target)) return true;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return false;
    }
    async apply(serial: string, user: number, target: unknown, stock: unknown, confirmed: unknown) {
        if (confirmed !== true) throw new Error('Confirm launcher recovery first.');
        if (this.saved(serial, user)) throw new Error('Restore the previous launcher operation first.');
        const state = await this.diagnose(serial, user);
        if (
            typeof target !== 'string' ||
            !state.launchers.includes(target) ||
            !state.home ||
            typeof stock !== 'string' ||
            !state.candidates.includes(stock) ||
            target.startsWith(`${stock}/`) ||
            STOCK.includes(target.split('/')[0]!) ||
            TV_COMPONENTS[target.split('/')[0]!] ||
            /FallbackHome|ResolverActivity|ChooserActivity/.test(target)
        )
            throw new Error('Choose a verified alternative and a supported stock launcher.');
        const dump = await this.adb.shell(serial, `dumpsys package ${shArg(stock)}`);
        if (!/pkgFlags=\[[^\]]*\bSYSTEM\b/.test(dump) || /pkgFlags=\[[^\]]*\bPERSISTENT\b/.test(dump))
            throw new Error('Stock launcher flags unavailable or protected. Nothing disabled.');
        const setup = await this.adb.shell(serial, `settings --user ${user} get secure user_setup_complete`);
        if (setup.trim() !== '1') throw new Error('Complete Android setup before replacing Home.');
        const enabled = new RegExp(`User ${user}: [^\\n]*enabled=(\\d+)`).exec(dump)?.[1];
        if (enabled !== '0' && enabled !== '1')
            throw new Error('Original launcher state unavailable. Nothing disabled.');
        await this.checkUser(serial, user);
        const started = await this.adb.shell(serial, `am start --user ${user} -W -n ${shArg(target)}`);
        if (!/^Status: ok\s*$/m.test(started) || !(await this.opened(serial, user, target)))
            throw new Error('Alternative launcher could not be verified. Nothing disabled.');
        const record: Recovery = { stock, previous: state.home, target, enabled: Number(enabled) };
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        writeFileAtomicSync(this.path(serial, user), JSON.stringify(record), { mode: 0o600 });
        try {
            await this.checkUser(serial, user);
            await this.adb.shell(serial, `cmd package set-home-activity --user ${user} ${shArg(target)}`);
            if ((await this.home(serial, user)) !== target) throw new Error('Android did not change the launcher.');
            await this.checkUser(serial, user);
            await this.adb.shell(serial, `pm disable-user --user ${user} ${shArg(stock)}`);
            const disabled = await this.adb.shell(serial, `pm list packages -d --user ${user}`);
            if (!disabled.split(/\r?\n/).includes(`package:${stock}`))
                throw new Error('Android did not disable the stock launcher.');
            await this.checkUser(serial, user);
            const away = await this.adb.shell(serial, `am start --user ${user} -W -a android.settings.SETTINGS`);
            if (!/^Status: ok\s*$/m.test(away)) throw new Error('Could not open TV settings.');
            const front = await this.adb.shell(serial, 'dumpsys activity activities');
            if (!/ResumedActivity[^\n]*(com.android.tv.settings|com.android.settings)\//.test(front))
                throw new Error('Could not verify the Settings screen. Home was not tested.');
            await this.checkUser(serial, user);
            await this.adb.shell(serial, 'input keyevent KEYCODE_HOME');
            if (!(await this.opened(serial, user, target))) throw new Error('Home did not open the expected launcher.');
            return { success: true, recovery: record };
        } catch (error) {
            try {
                await this.restore(serial, user);
            } catch (rollback) {
                throw new Error(`${String(error)} — ${String(rollback)}. Use Restore stock launcher when connected.`);
            }
            throw new Error(`${String(error)} — Original launcher restored.`);
        }
    }
    async restore(serial: string, user: number) {
        const record = this.saved(serial, user);
        if (!record) throw new Error('No launcher recovery saved.');
        if (
            !STOCK.includes(record.stock) ||
            !/^[\w.]+\/[\w.$]+$/.test(record.previous) ||
            ![0, 1].includes(record.enabled)
        )
            throw new Error('Invalid launcher recovery record.');
        await this.checkUser(serial, user);
        await this.adb.shell(
            serial,
            `pm ${record.enabled === 0 ? 'default-state' : 'enable'} --user ${user} ${shArg(record.stock)}`,
        );
        const dump = await this.adb.shell(serial, `dumpsys package ${shArg(record.stock)}`);
        if (new RegExp(`User ${user}: [^\\n]*enabled=(\\d+)`).exec(dump)?.[1] !== String(record.enabled))
            throw new Error('Stock launcher restoration could not be verified.');
        await this.checkUser(serial, user);
        await this.adb.shell(serial, `cmd package set-home-activity --user ${user} ${shArg(record.previous)}`);
        if ((await this.home(serial, user)) !== record.previous)
            throw new Error('Original Home restoration could not be verified.');
        await this.checkUser(serial, user);
        unlinkSync(this.path(serial, user));
        return { success: true };
    }
}
