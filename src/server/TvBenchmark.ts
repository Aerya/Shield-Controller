import type { AdbClient } from './AdbClient';
import { components } from './DeviceTweaks';
import { shArg } from './security/deviceInput';

export function launchTime(output: string): number | null {
    if (!/^Status: ok\s*$/m.test(output) || /Warning:|Error:|Exception/i.test(output)) return null;
    const value = /^TotalTime:\s*(\d+)\s*$/m.exec(output)?.[1];
    return value === undefined ? null : Number(value);
}
export function frameSummary(output: string) {
    const frames = /^\s*Total frames rendered:\s*(\d+)/m.exec(output)?.[1];
    const janky = /^\s*Janky frames:\s*(\d+)/m.exec(output)?.[1];
    return { frames: frames === undefined ? null : Number(frames), janky: janky === undefined ? null : Number(janky) };
}
export async function benchmarkLauncher(adb: Pick<AdbClient, 'shell'>, serial: string, user: number) {
    const guard = async () => {
        if ((await adb.shell(serial, 'am get-current-user')).trim() !== String(user))
            throw new Error('Android user changed. Refresh diagnostics.');
    };
    const shell = async (command: string) => {
        await guard();
        return adb.shell(serial, command);
    };
    const home = components(
        await shell(
            `cmd package resolve-activity --brief --user ${user} -a android.intent.action.MAIN -c android.intent.category.HOME`,
        ),
    ).at(-1);
    if (!home || home.startsWith('android/') || /setupwraith|provision/i.test(home))
        throw new Error('Default launcher unavailable.');
    const pkg = home.split('/')[0]!;
    const settings = await shell(`am start --user ${user} -W -a android.settings.SETTINGS`);
    if (!/^Status: ok\s*$/m.test(settings)) throw new Error('Could not open TV settings.');
    // Timed Android HOME intent, not end-to-end physical remote latency.
    const warm = await shell(
        `am start --user ${user} -W -a android.intent.action.MAIN -c android.intent.category.HOME`,
    );
    const focused = await shell('dumpsys activity activities');
    const line = focused.split('\n').find((l) => /topResumedActivity|mResumedActivity/.test(l)) ?? '';
    if (!components(line).some((c) => c.startsWith(`${pkg}/`)))
        throw new Error('Home did not open the expected launcher.');
    const initial = frameSummary(await shell(`dumpsys gfxinfo ${shArg(pkg)}`));
    for (const key of [22, 22, 21, 21, 20, 19]) {
        await shell(`input keyevent ${key}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const final = frameSummary(await shell(`dumpsys gfxinfo ${shArg(pkg)}`));
    const mem = await shell(`dumpsys meminfo ${shArg(pkg)}`);
    const pss = /^\s*TOTAL PSS:\s*(\d+)/m.exec(mem)?.[1] ?? /^\s*TOTAL\s+(\d+)/m.exec(mem)?.[1];
    // Explicitly confirmed by the UI: stopping Home is needed for a cold start, then immediately reopen it.
    let cold: string;
    try {
        await shell(`am force-stop --user ${user} ${shArg(pkg)}`);
        cold = await shell(`am start --user ${user} -W -n ${shArg(home)}`);
    } finally {
        // Never act on another user after a profile switch.
        await shell('input keyevent KEYCODE_HOME');
    }
    const delta = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? b - a : null);
    const frames = delta(initial.frames, final.frames);
    const janky = delta(initial.janky, final.janky);
    return {
        at: new Date().toISOString(),
        user,
        home,
        coldMs: launchTime(cold),
        homeMs: launchTime(warm),
        frames,
        janky: frames !== null && janky !== null && janky <= frames ? janky : null,
        pssKiB: pss === undefined ? null : Number(pss),
    };
}
