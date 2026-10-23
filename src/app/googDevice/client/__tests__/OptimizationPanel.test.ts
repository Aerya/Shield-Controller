// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OptimizationPanel } from '../OptimizationPanel';

const fetchMock = vi.fn();
let host: HTMLElement;
let panel: OptimizationPanel;
const snapshot = () => ({
    user: 0,
    reliable: true,
    processes: 'CPU snapshot',
    memory: 'MemTotal: 123',
    storage: '/data',
    history: [],
    apps: [
        {
            packageName: 'com.home.app',
            disabled: false,
            category: 'Application',
            protection: 'Active launcher',
            manual: false,
        },
        {
            packageName: 'com.nvidia.stats',
            disabled: false,
            category: 'Telemetry / feedback',
            protection: null,
            manual: false,
        },
        {
            packageName: 'com.plexapp.mediaserver.smb',
            disabled: true,
            category: 'Local Plex server',
            protection: null,
            manual: false,
        },
    ],
});
const ready = async () => {
    panel = new OptimizationPanel(host, 'tv');
    await vi.waitFor(() => expect(host.querySelectorAll('.manager-app')).toHaveLength(3));
};
const row = (pkg: string) =>
    [...host.querySelectorAll<HTMLElement>('.manager-app')].find((item) => item.textContent?.includes(pkg))!;
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => snapshot() }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
    panel?.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});
it('loads without mutating and disables only protected controls', async () => {
    await ready();
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(row('com.home.app').querySelector('button')?.disabled).toBe(true);
    expect(row('com.nvidia.stats').querySelector('button')?.disabled).toBe(false);
    expect(row('com.plexapp.mediaserver.smb').querySelector('button')?.textContent).toBe('Enable');
});
it('requires confirmation and sends only the selected action', async () => {
    await ready();
    vi.mocked(window.confirm).mockReturnValue(false);
    row('com.nvidia.stats').querySelector('button')!.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    row('com.nvidia.stats').querySelector('button')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
        packageName: 'com.nvidia.stats',
        action: 'disable',
        user: 0,
    });
});
it('supports filtering the Plex server separately and manual protection', async () => {
    await ready();
    const filter = host.querySelector('select')!;
    filter.value = 'Local Plex server';
    filter.dispatchEvent(new Event('change'));
    expect(host.querySelectorAll('.manager-app')).toHaveLength(1);
    expect(host.querySelector('.manager-app')?.textContent).toContain('com.plexapp.mediaserver.smb');
    row('com.plexapp.mediaserver.smb').querySelectorAll('button')[1]!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).action).toBe('protect');
});
it('shows action errors and permits a fresh diagnostic', async () => {
    await ready();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Android refused' }) });
    row('com.nvidia.stats').querySelector('button')!.click();
    await vi.waitFor(() => expect(host.querySelector('[role=status]')?.textContent).toContain('Android refused'));
    const refresh = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Refresh')!;
    expect(refresh.disabled).toBe(false);
});
it('keeps reactivation available when protection detection is unknown', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ...snapshot(), reliable: false }) }));
    await ready();
    expect(row('com.nvidia.stats').querySelector('button')?.disabled).toBe(true);
    expect(row('com.plexapp.mediaserver.smb').querySelector('button')?.disabled).toBe(false);
});

it('keeps every system package accessible in the advanced paginated view', async () => {
    const systemApps = Array.from({ length: 29 }, (_, index) => ({
        packageName: `com.system.app${String(index).padStart(2, '0')}`,
        system: true,
        category: 'Application',
        disabled: false,
        protection: null,
        manual: false,
    }));
    fetchMock.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ ...snapshot(), apps: [...snapshot().apps, ...systemApps] }),
    }));
    await ready();
    expect(host.querySelector('select')!.value).toBe('focused');
    const filter = host.querySelector('select')!;
    filter.value = 'all';
    filter.dispatchEvent(new Event('change'));
    const visited = new Set<string>();
    const next = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Next')!;
    for (let page = 0; page < 4; page++) {
        expect(host.querySelectorAll('.manager-app').length).toBeLessThanOrEqual(12);
        for (const identifier of host.querySelectorAll('.manager-app [data-i18n-skip]'))
            visited.add(identifier.textContent!);
        if (next.disabled) break;
        next.click();
    }
    expect(visited.size).toBe(32);
    expect(visited.has('com.system.app28')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('searches readable names, explanations and identifiers, resetting pagination', async () => {
    await ready();
    expect(row('com.nvidia.stats').querySelector('strong')?.textContent).toBe('NVIDIA usage statistics');
    expect(row('com.nvidia.stats').textContent).toContain('does not guarantee a performance gain');
    const search = host.querySelector<HTMLInputElement>('input[type=search]')!;
    for (const query of ['usage statistics', 'com.nvidia.stats', 'performance gain']) {
        search.value = query;
        search.dispatchEvent(new Event('input'));
        expect(host.querySelectorAll('.manager-app')).toHaveLength(1);
        expect(host.querySelector('.manager-app')?.textContent).toContain('com.nvidia.stats');
    }
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Show protected apps')!.click();
    expect(search.value).toBe('');
    expect(host.querySelectorAll('.manager-app')).toHaveLength(1);
    expect(host.querySelector('.manager-app')?.textContent).toContain('com.home.app');
});
it('puts diagnostics above the list and explicitly describes unknown packages', async () => {
    await ready();
    expect(
        host
            .querySelector('.optimization-diagnostics')!
            .compareDocumentPosition(host.querySelector('.optimization-list')!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(row('com.home.app').querySelector('strong')?.textContent).toBe('Unidentified application');
    expect(row('com.home.app').textContent).toContain('Name and role not documented');
});
