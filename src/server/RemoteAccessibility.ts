import type { AdbClient } from './AdbClient';
import { shArg } from './security/deviceInput';

export const REMOTE_SERVICE = 'org.shieldcontroller.remote/org.shieldcontroller.remote.RemoteService';
const SHORT_SERVICE = 'org.shieldcontroller.remote/.RemoteService';
const ownService = (s: string) => s === REMOTE_SERVICE || s === SHORT_SERVICE;
export function accessibilityServices(raw: string): string[] {
    const value = raw.trim();
    if (value === '' || value === 'null') return [];
    if (value.length > 16384) throw new Error('Accessibility settings unavailable. Nothing changed.');
    const services = value.split(':');
    if (services.some((s) => !/^[a-zA-Z][\w]*(?:\.[\w]+)+\/[\w.$]+$/.test(s)))
        throw new Error('Accessibility settings unavailable. Nothing changed.');
    return services;
}
/** Only touches this companion's membership. Other components keep their spelling and order. */
export async function setRemoteAccessibility(
    adb: Pick<AdbClient, 'shell'>,
    serial: string,
    user: number,
    enabled: boolean,
) {
    const checkUser = async () => {
        if ((await adb.shell(serial, 'am get-current-user')).trim() !== String(user))
            throw new Error('Android user changed. Refresh diagnostics.');
    };
    const get = (key: string) => adb.shell(serial, `settings --user ${user} get secure ${key}`);
    await checkUser();
    const original = await get('enabled_accessibility_services');
    const services = accessibilityServices(original);
    const flag = (await get('accessibility_enabled')).trim();
    if (!['0', '1', 'null'].includes(flag)) throw new Error('Accessibility settings unavailable. Nothing changed.');
    const others = services.filter((s) => !ownService(s));
    if (enabled && flag !== '1' && others.length)
        throw new Error(
            'Other accessibility services are globally disabled. Enable the companion from TV settings to avoid activating them.',
        );
    const next = enabled ? [...others, REMOTE_SERVICE] : others;
    // Refuse a detected concurrent edit instead of replacing another application's new grant.
    await checkUser();
    if (
        (await get('enabled_accessibility_services')) !== original ||
        (await get('accessibility_enabled')).trim() !== flag
    )
        throw new Error('Accessibility settings changed. Refresh and try again.');
    if (next.join(':') !== services.join(':')) {
        await adb.shell(
            serial,
            `settings --user ${user} put secure enabled_accessibility_services ${shArg(next.join(':'))}`,
        );
    }
    await checkUser();
    const after = accessibilityServices(await get('enabled_accessibility_services'));
    if (after.some(ownService) !== enabled || others.some((s) => !after.includes(s)))
        throw new Error('Android did not apply remote accessibility. Refresh its status before retrying.');
    // Disabling never changes the global accessibility flag or disables another service.
    if (enabled && flag !== '1') {
        if (after.some((s) => !ownService(s)))
            throw new Error('Accessibility settings changed. Refresh and try again.');
        await checkUser();
        await adb.shell(serial, `settings --user ${user} put secure accessibility_enabled 1`);
        if ((await get('accessibility_enabled')).trim() !== '1')
            throw new Error('Android did not apply remote accessibility. Refresh its status before retrying.');
    }
    await checkUser();
}
