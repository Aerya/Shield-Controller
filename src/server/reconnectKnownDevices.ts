import type { AdbClient } from './AdbClient';
import type { DeviceRecord } from './db/DeviceStore';
import { isConnectAddress } from './security/deviceInput';

/** Restore remembered network connections once at startup, after ADB is ready.
 * Does not poll, pair new devices or undo a manual disconnect during this run. */
export async function reconnectKnownDevices(
    adb: Pick<AdbClient, 'devices' | 'connect'>,
    remembered: DeviceRecord[],
): Promise<{ restored: number; failed: number }> {
    const addresses = new Set(
        remembered.flatMap((device) =>
            device.address && device.model && isConnectAddress(device.address) ? [device.address] : [],
        ),
    );
    if (!addresses.size) return { restored: 0, failed: 0 };
    const connected = new Set(
        (await adb.devices()).filter((device) => device.state === 'device').map((device) => device.serial),
    );
    let restored = 0;
    let failed = 0;
    for (const address of addresses) {
        if (connected.has(address)) continue;
        try {
            const result = await adb.connect(address);
            if (/\bconnected to\b/i.test(result) && !/cannot|unable|failed|unauthorized/i.test(result)) restored++;
            else failed++;
        } catch {
            failed++;
        }
    }
    return { restored, failed };
}
