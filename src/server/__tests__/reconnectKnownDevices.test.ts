import { describe, expect, it, vi } from 'vitest';
import type { DeviceRecord } from '../db/DeviceStore';
import { reconnectKnownDevices } from '../reconnectKnownDevices';

const remembered = (address: string | null, model: string | null = 'SHIELD'): DeviceRecord => ({
    serial: 'demo',
    manufacturer: 'NVIDIA',
    model,
    address,
    lastSeenAt: 1,
});
describe('startup device reconnection', () => {
    it('restores remembered devices once and skips already connected ones', async () => {
        const adb = {
            devices: vi.fn(async () => [{ serial: '192.0.2.10:5555', state: 'device' }]),
            connect: vi.fn(async (address: string) => `connected to ${address}`),
        };
        expect(
            await reconnectKnownDevices(adb, [
                remembered('192.0.2.10:5555'),
                remembered('192.0.2.20:5555'),
                remembered('192.0.2.20:5555'),
            ]),
        ).toEqual({ restored: 1, failed: 0 });
        expect(adb.connect).toHaveBeenCalledExactlyOnceWith('192.0.2.20:5555');
    });
    it('ignores USB devices, unidentified scan hits and unsafe addresses', async () => {
        const adb = { devices: vi.fn(async () => []), connect: vi.fn(async () => '') };
        expect(
            await reconnectKnownDevices(adb, [
                remembered(null),
                remembered('192.0.2.20:5555', null),
                remembered('-H'),
                remembered('192.0.2.20;reboot'),
            ]),
        ).toEqual({ restored: 0, failed: 0 });
        expect(adb.devices).not.toHaveBeenCalled();
        expect(adb.connect).not.toHaveBeenCalled();
    });
    it('reports unavailable devices without preventing another device from reconnecting', async () => {
        const adb = {
            devices: vi.fn(async () => []),
            connect: vi.fn(async (address: string) => {
                if (address === '192.0.2.10:5555') throw new Error('offline');
                return `connected to ${address}`;
            }),
        };
        expect(
            await reconnectKnownDevices(adb, [remembered('192.0.2.10:5555'), remembered('192.0.2.20:5555')]),
        ).toEqual({ restored: 1, failed: 1 });
    });
    it('never counts a failed authentication as a restored connection', async () => {
        const adb = { devices: vi.fn(async () => []), connect: vi.fn(async () => 'failed to authenticate') };
        expect(await reconnectKnownDevices(adb, [remembered('192.0.2.20:5555')])).toEqual({ restored: 0, failed: 1 });
    });
});
