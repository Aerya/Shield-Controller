// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceToolsModal } from '../DeviceToolsModal';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

it('shows a separate provider or network operator for every detected resolver, including unknowns', async () => {
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
        const button = [...document.querySelectorAll('button')].find(
            (node) => node.textContent === 'Detect public IP and DNS resolvers',
        )!;
        button.click();
        await vi.waitFor(() =>
            expect(document.body.textContent).toContain('192.0.2.53 — Example ISP (AS64500) · Network operator'),
        );
        expect(document.body.textContent).toContain('1.1.1.1 — Cloudflare');
        expect(document.body.textContent).toContain('2001:db8::53 — Unknown provider');
    } finally {
        panel.close();
    }
});
