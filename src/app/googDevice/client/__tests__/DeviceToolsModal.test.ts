// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceToolsModal } from '../DeviceToolsModal';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

it('automatically shows a separate provider or network operator for every detected resolver, including unknowns', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => ({
            ok: true,
            json: async () =>
                url.includes('/internet?')
                    ? {
                          provider: 'IPleak.net',
                          testedAt: 'test',
                          results: [{ family: 'IPv4', address: '198.51.100.1', error: null }],
                          resolverDetails: [
                              { address: '1.1.1.1', provider: 'Cloudflare', source: 'known-service' },
                              { address: '192.0.2.53', provider: 'Example ISP (AS64500)', source: 'network-owner' },
                              { address: '2001:db8::53', provider: null, source: 'unknown' },
                          ],
                      }
                    : { servers: [], mode: 'off', hostname: '', privateDnsValidated: false },
        })),
    );
    const panel = new DeviceToolsModal('device', 'dns');
    try {
        expect(
            [...document.querySelectorAll('button')].some(
                (node) => node.textContent === 'Detect public IP and DNS resolvers',
            ),
        ).toBe(false);
        await vi.waitFor(() =>
            expect(document.body.textContent).toContain('192.0.2.53 — Example ISP (AS64500) · Network operator'),
        );
        expect(document.body.textContent).toContain('1.1.1.1 — Cloudflare');
        expect(document.body.textContent).toContain('2001:db8::53 — Unknown provider');
    } finally {
        panel.close();
    }
});

it('keeps local DNS settings usable when automatic public detection fails', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.includes('/internet?')) throw new Error('External service unavailable');
            return {
                ok: true,
                json: async () => ({ servers: ['192.0.2.53'], mode: 'off', hostname: '', privateDnsValidated: false }),
            };
        }),
    );
    const panel = new DeviceToolsModal('device', 'dns');
    try {
        await vi.waitFor(() => expect(document.body.textContent).toContain('External service unavailable'));
        expect(document.querySelector('.manager-info')?.textContent).toContain('192.0.2.53');
        expect(
            [...document.querySelectorAll('button')].find((node) => node.textContent === 'Apply Private DNS')?.disabled,
        ).toBe(false);
    } finally {
        panel.close();
    }
});

it('shares the pending detection when a DNS panel is closed and immediately reopened', async () => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    let complete!: (response: unknown) => void;
    const pending = new Promise((resolve) => {
        complete = resolve;
    });
    const fetch = vi.fn(async (url: string) =>
        url.includes('/internet?')
            ? pending
            : {
                  ok: true,
                  json: async () => ({ servers: [], mode: 'off', hostname: '', privateDnsValidated: false }),
              },
    );
    vi.stubGlobal('fetch', fetch);
    const first = new DeviceToolsModal('reopened-device', 'dns');
    first.close();
    const second = new DeviceToolsModal('reopened-device', 'dns');
    try {
        expect(fetch.mock.calls.filter(([url]) => url.includes('/internet?'))).toHaveLength(1);
        complete({
            ok: true,
            json: async () => ({
                provider: 'IPleak.net',
                testedAt: 'test',
                results: [],
                resolverDetails: [{ address: '1.1.1.1', provider: 'Cloudflare', source: 'known-service' }],
            }),
        });
        await vi.waitFor(() => expect(document.body.textContent).toContain('1.1.1.1 — Cloudflare'));
        await vi.waitFor(() => expect(document.querySelectorAll('dialog')).toHaveLength(1));
    } finally {
        second.close();
    }
});
