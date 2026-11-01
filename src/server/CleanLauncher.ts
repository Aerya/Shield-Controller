import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdbClient } from './AdbClient';

export const CLEAN_LAUNCHER = {
    packageName: 'com.gathin.tvhome',
    component: 'com.gathin.tvhome/.MainActivity',
    version: '3.1',
    revision: 'fcde1eedb4d6cc5ab683a6e0e9e1bc79229b898e',
    sha256: '91a33e1664725da9eec88403ebda06a443665b5da22c5770d7991375c88e456f',
    minSdk: 26,
};
export async function installCleanLauncher(adb: Pick<AdbClient, 'shell' | 'installApk'>, serial: string, user: number) {
    if (user !== 0) throw new Error('Launcher installation is available for Android user 0 only.');
    const sdk = (await adb.shell(serial, 'getprop ro.build.version.sdk')).trim();
    if (!/^\d+$/.test(sdk) || Number(sdk) < CLEAN_LAUNCHER.minSdk)
        throw new Error('This launcher requires Android 8 or newer.');
    const path = join(process.cwd(), 'assets', 'launchers', 'cleanyourtv.apk');
    const apk = await readFile(path);
    if (createHash('sha256').update(apk).digest('hex') !== CLEAN_LAUNCHER.sha256)
        throw new Error('Launcher checksum mismatch. Nothing installed.');
    if ((await adb.shell(serial, 'am get-current-user')).trim() !== '0')
        throw new Error('Android user changed. Refresh diagnostics.');
    const output = await adb.installApk(serial, path);
    if (!/\bSuccess\b/.test(output)) throw new Error(output || 'Android refused the APK.');
    const packages = await adb.shell(serial, `pm list packages --user 0 ${CLEAN_LAUNCHER.packageName}`);
    if (!packages.split(/\r?\n/).includes(`package:${CLEAN_LAUNCHER.packageName}`))
        throw new Error('Launcher installation could not be verified.');
    return { success: true, version: CLEAN_LAUNCHER.version };
}
export async function openCleanLauncher(adb: Pick<AdbClient, 'shell'>, serial: string, user: number) {
    const component = CLEAN_LAUNCHER.component;
    const result = await adb.shell(serial, `am start --user ${user} -W -n ${component}`);
    if (!/^Status: ok\s*$/m.test(result) || /Error|Exception/i.test(result))
        throw new Error('Could not open the launcher.');
    return { success: true };
}
