import { expect, it } from 'vitest';
import { cpuUsage, diskUsage, temperatures } from '../DeviceMetrics';

it('measures CPU deltas and rejects unreadable or unchanged counters', () => {
    expect(cpuUsage('cpu  10 0 10 80 0 0 0 0 0 0\ncpu  20 0 20 160 0 0 0 0 0 0')).toBe(20);
    expect(cpuUsage('Permission denied')).toBeNull();
    expect(cpuUsage('cpu 1 2 3 4\ncpu 1 2 3 4')).toBeNull();
});
it('prefers current HAL sensor readings over the cached readings', () => {
    expect(
        temperatures(
            'Cached temperatures:\nTemperature{mValue=54, mType=0, mName=CPU0, mStatus=0}\nCurrent temperatures from HAL:\nTemperature{mValue=35.500004, mType=0, mName=CPU0, mStatus=0}\nCurrent cooling devices from HAL:',
        ),
    ).toEqual([{ name: 'CPU0', celsius: 35.5 }]);
    expect(temperatures('Permission denied')).toEqual([]);
});
it('keeps separate mount rows without summing shared Android storage twice', () => {
    expect(
        diskUsage(
            'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/data 1000 400 600 40% /data\n/dev/fuse 1000 400 600 40% /storage/emulated',
        ),
    ).toHaveLength(2);
    expect(diskUsage('Unavailable')).toEqual([]);
});
