// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceManagerModal } from '../DeviceManagerModal';

const apps = [
    {
        packageName: 'org.example.player',
        versionCode: '42',
        path: '/data/app/player.apk',
        system: false,
        disabled: false,
    },
    {
        packageName: 'com.vendor.launcher',
        versionCode: '7',
        path: '/system/app/launcher.apk',
        system: true,
        disabled: true,
    },
];
const fetchMock = vi.fn();
beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ apps }) }));
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

async function openApps(): Promise<void> {
    new DeviceManagerModal('192.0.2.20:5555', 'Demo TV', 'apps');
    await vi.waitFor(() => expect(document.querySelector('.manager-app-list')).not.toBeNull());
}

describe('Shield Controller management panel', () => {
    it('loads user applications, switches to system/disabled apps and searches', async () => {
        await openApps();
        expect(document.querySelector('.manager-app-list')?.textContent).toContain('org.example.player');
        expect(document.querySelector('.manager-app-list')?.textContent).not.toContain('com.vendor.launcher');
        const filter = document.querySelector('select')!;
        filter.value = 'disabled';
        filter.dispatchEvent(new Event('change'));
        expect(document.querySelector('.manager-app-list')?.textContent).toContain('com.vendor.launcher');
        const search = document.querySelector<HTMLInputElement>('input[type=search]')!;
        search.value = 'absent';
        search.dispatchEvent(new Event('input'));
        expect(document.querySelector('.manager-app-list')?.textContent).toBe('No matching applications.');
    });
    it('requires confirmation before uninstall and refreshes the list after success', async () => {
        await openApps();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        (document.querySelector('.manager-app button') as HTMLButtonElement).click();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        confirm.mockReturnValue(true);
        (document.querySelector('.manager-app button') as HTMLButtonElement).click();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1]![0]).toContain('/uninstall?serial=');
        expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ packageName: 'org.example.player' });
        await vi.waitFor(() =>
            expect(document.querySelector('.manager-app-list')?.textContent).not.toContain('org.example.player'),
        );
    });
    it('rejects unsupported dropped bundles without uploading them', async () => {
        await openApps();
        const event = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['test'], 'bundle.xapk')] } });
        document.querySelector('.manager-apk-drop')!.dispatchEvent(event);
        expect(document.querySelector('[role=status]')?.textContent).toContain('not supported');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('uploads an APK, reports progress and refreshes installed applications', async () => {
        let sent: File | undefined;
        class FakeXHR {
            upload: Record<string, (event?: any) => void> = {};
            status = 200;
            responseText = '{"success":true}';
            timeout = 0;
            onload?: () => void;
            open = vi.fn();
            setRequestHeader = vi.fn();
            abort = vi.fn();
            send(file: File) {
                sent = file;
                this.upload['onprogress']?.({ lengthComputable: true, loaded: 2, total: 4 });
                expect(document.querySelector('[role=status]')?.textContent).toContain('50%');
                this.upload['onload']?.();
                this.onload?.();
            }
        }
        vi.stubGlobal('XMLHttpRequest', FakeXHR);
        await openApps();
        const file = new File(['PK\x03\x04'], 'demo.apk');
        const event = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
        document.querySelector('.manager-apk-drop')!.dispatchEvent(event);
        await vi.waitFor(() =>
            expect(document.querySelector('[role=status]')?.textContent).toContain('1 APK(s) installed successfully'),
        );
        expect(sent).toBe(file);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it('renders device-controlled values as text, never HTML', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                properties: { 'ro.product.model': '<img src=x onerror=alert(1)>' },
                memory: 'MemTotal: 4194304 kB',
                uptime: '90000 1',
            }),
        });
        new DeviceManagerModal('192.0.2.20:5555', 'TV', 'info');
        await vi.waitFor(() => expect(document.querySelector('.manager-info')).not.toBeNull());
        expect(document.querySelector('.manager-info')?.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(document.querySelector('.manager-info img')).toBeNull();
        expect(document.querySelector('.manager-info')?.textContent).toContain('4.00 GiB');
    });
    it('shows connection or authorization errors in the panel', async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Device disconnected' }) });
        new DeviceManagerModal('192.0.2.20:5555', 'TV', 'apps');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=status]')?.textContent).toBe('Device disconnected'),
        );
    });
});

describe('device telemetry', () => {
    it('renders CPU, RAM, separate storage mounts, temperatures and launcher from device readings', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                properties: {},
                memory: 'MemTotal: 2097152 kB\nMemAvailable: 1048576 kB',
                uptime: '3600',
                metrics: {
                    cpuPercent: 12.5,
                    projectivyInstalled: true,
                    projectivyAccessibility: true,
                    temperatures: [{ name: 'CPU0', celsius: 35.5 }],
                    launcher: 'com.example.home/.Main',
                    foreground: 'com.example.player/.Main',
                    disks: [
                        { mount: '/data', usedKiB: 1048576, totalKiB: 2097152, availableKiB: 1048576, percent: 50 },
                    ],
                },
            }),
        });
        const modal = new DeviceManagerModal('device', 'Demo TV', 'info');
        await vi.waitFor(() => expect(document.querySelector('.manager-info')?.textContent).toContain('12.5 %'));
        const text = document.querySelector('.manager-info')!.textContent!;
        expect(text).toContain('1.00 GiB (50%)');
        expect(text).toContain('35.5 °C');
        expect(text).toContain('com.example.home/.Main');
        expect(text).toContain('com.example.player/.Main');
        expect(text).toContain('1.00 / 2.00 GiB (50%)');
        expect(document.querySelector('.manager-info')!.textContent).not.toContain('Projectivy');
        expect(
            [...document.querySelectorAll('.modal-body button')].some((node) =>
                ['Device information', 'Applications'].includes(node.textContent!),
            ),
        ).toBe(false);
        modal.close();
    });
});
