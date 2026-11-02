import { describe, expect, it, vi } from 'vitest';
import { accessibilityServices, REMOTE_SERVICE, setRemoteAccessibility } from '../RemoteAccessibility';

function fixture(initial = 'com.reader/com.reader.Service', global = '1') {
    let services = initial;
    let flag = global;
    let user = '0';
    let reject = false;
    let reads = 0;
    let race = false;
    const adb = {
        shell: vi.fn(async (_serial: string, cmd: string) => {
            if (cmd === 'am get-current-user') return user;
            if (cmd.includes('get secure enabled_accessibility_services')) {
                if (race && ++reads === 2) services += ':com.other/.Service';
                return services;
            }
            if (cmd.includes('get secure accessibility_enabled')) return flag;
            if (cmd.includes('put secure enabled_accessibility_services')) {
                if (!reject) services = /'([^']*)'$/.exec(cmd)![1]!;
                return '';
            }
            if (cmd.endsWith('put secure accessibility_enabled 1')) {
                flag = '1';
                return '';
            }
            throw new Error(cmd);
        }),
    };
    return {
        adb,
        state: () => ({ services, flag }),
        switchUser: () => {
            user = '10';
        },
        refuse: () => {
            reject = true;
        },
        concurrent: () => {
            race = true;
        },
    };
}
describe('remote accessibility activation', () => {
    it('adds and removes only the companion, preserving other services and the global flag', async () => {
        const f = fixture();
        await setRemoteAccessibility(f.adb, 'tv', 0, true);
        expect(f.state()).toEqual({ services: `com.reader/com.reader.Service:${REMOTE_SERVICE}`, flag: '1' });
        await setRemoteAccessibility(f.adb, 'tv', 0, false);
        expect(f.state()).toEqual({ services: 'com.reader/com.reader.Service', flag: '1' });
    });
    it('enables an empty list and recognizes the short component name without duplicating it', async () => {
        const f = fixture('null', '0');
        await setRemoteAccessibility(f.adb, 'tv', 0, true);
        expect(f.state()).toEqual({ services: REMOTE_SERVICE, flag: '1' });
        const short = fixture('org.shieldcontroller.remote/.RemoteService');
        await setRemoteAccessibility(short.adb, 'tv', 0, true);
        expect(short.state().services).toBe(REMOTE_SERVICE);
    });
    it('refuses malformed output, switched users, concurrent edits and disabled unrelated services', async () => {
        for (const value of ['Error: denied', 'com.reader/.Service:bad;reboot', 'com.reader/.Service:'])
            expect(() => accessibilityServices(value)).toThrow('unavailable');
        const switched = fixture();
        switched.switchUser();
        await expect(setRemoteAccessibility(switched.adb, 'tv', 0, true)).rejects.toThrow('user changed');
        const race = fixture();
        race.concurrent();
        await expect(setRemoteAccessibility(race.adb, 'tv', 0, true)).rejects.toThrow('settings changed');
        const off = fixture('com.reader/.Service', '0');
        await expect(setRemoteAccessibility(off.adb, 'tv', 0, true)).rejects.toThrow('globally disabled');
        for (const f of [switched, race, off])
            expect(f.adb.shell.mock.calls.some(([, c]) => c.includes(' put '))).toBe(false);
    });
    it('never reports a refused write as applied', async () => {
        const f = fixture();
        f.refuse();
        await expect(setRemoteAccessibility(f.adb, 'tv', 0, true)).rejects.toThrow('did not apply');
        expect(f.state().services).toBe('com.reader/com.reader.Service');
    });
});
