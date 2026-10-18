import { RemotePreview } from './RemotePreview';
import '../../../style/device-manager.css';
import { t } from '../../client/Language';
import { Modal } from '../../ui/Modal';

interface DnsState {
    servers: string[];
    mode: string;
    hostname: string;
    privateDnsValidated: boolean;
}
interface InternetResult {
    provider: string;
    testedAt: string;
    results: { family: string; address: string | null; error: string | null }[];
    resolverDetails: { address: string; provider: string | null; source: string }[];
}
// Reopening a panel shares its in-flight test instead of starting competing ADB probes.
const internetTests = new Map<string, Promise<InternetResult>>();
export class DeviceToolsModal extends Modal {
    declare private status: HTMLElement;
    private disposed = false;
    private previewUrl: string | undefined;
    private preview: RemotePreview | undefined;
    constructor(
        private readonly serial: string,
        tool: 'screenshot' | 'dns' | 'remote',
    ) {
        super({ title: tool === 'dns' ? 'DNS / IPv4 / IPv6' : tool === 'remote' ? 'View / Control' : 'Screenshot' });
        this.frameEl.classList.add('device-manager');
        if (tool !== 'dns') this.preview = new RemotePreview(this.bodyEl, serial, tool === 'remote');
        else void this.dnsPanel();
    }
    protected override buildBody(container: HTMLElement): void {
        this.status = document.createElement('p');
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        container.append(this.status);
    }
    override close(result?: unknown): void {
        this.disposed = true;
        this.preview?.dispose();
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        super.close(result);
    }
    private async request(action: string, body?: unknown): Promise<Response> {
        const response = await fetch(
            `/api/manager/${action}?serial=${encodeURIComponent(this.serial)}`,
            body === undefined
                ? {}
                : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        return response;
    }
    private button(label: string, action: () => Promise<void>): HTMLButtonElement {
        const button = document.createElement('button');
        button.textContent = label;
        button.addEventListener('click', async () => {
            button.disabled = true;
            this.status.textContent = 'Loading…';
            try {
                await action();
            } catch (error) {
                if (!this.disposed) this.status.textContent = error instanceof Error ? error.message : String(error);
            } finally {
                button.disabled = false;
            }
        });
        return button;
    }
    private async dnsPanel(): Promise<void> {
        const stateOutput = document.createElement('dl');
        stateOutput.className = 'manager-info';
        stateOutput.style.whiteSpace = 'pre-wrap';
        const mode = document.createElement('select');
        mode.setAttribute('aria-label', 'Private DNS mode');
        for (const [value, label] of [
            ['opportunistic', 'Automatic'],
            ['off', 'Off'],
            ['hostname', 'Private DNS provider'],
        ]) {
            const option = document.createElement('option');
            option.value = value!;
            option.textContent = label!;
            mode.append(option);
        }
        const hostname = document.createElement('input');
        hostname.placeholder = 'Private DNS provider hostname';
        hostname.setAttribute('aria-label', 'Private DNS provider hostname');
        const domain = document.createElement('input');
        domain.value = 'example.com';
        domain.placeholder = 'Domain to test';
        domain.setAttribute('aria-label', 'Domain to test');
        const server = document.createElement('input');
        server.placeholder = 'Optional DNS server (IPv4 or IPv6)';
        server.setAttribute('aria-label', 'Optional DNS server (IPv4 or IPv6)');
        const results = document.createElement('div');
        results.style.whiteSpace = 'pre-wrap';
        const show = (data: DnsState): void => {
            stateOutput.replaceChildren();
            for (const [label, value] of [
                ['DNS servers', data.servers.join(', ') || '—'],
                ['Private DNS mode', data.mode],
                ['Provider hostname', data.hostname || '—'],
                ['TLS validation', data.privateDnsValidated ? 'Validated' : 'Not reported'],
            ]) {
                const term = document.createElement('dt');
                term.textContent = label!;
                const definition = document.createElement('dd');
                definition.textContent = value!;
                if (!['Validated', 'Not reported'].includes(value!)) definition.dataset['i18nSkip'] = '';
                stateOutput.append(term, definition);
            }
            mode.value = data.mode;
            hostname.value = data.hostname;
        };
        const note = document.createElement('p');
        note.textContent =
            'Ethernet DNS addresses come from the TV network settings or DHCP. This Android version does not expose a safe ADB command to edit them. Private DNS accepts a provider hostname and works with IPv4 and IPv6.';
        const testNote = document.createElement('p');
        testNote.textContent =
            'Leave the DNS server blank to test resolution on the Shield. A specific DNS server is queried from the Shield Controller server; its result does not prove the Shield uses it.';
        const toolbar = document.createElement('div');
        toolbar.className = 'manager-toolbar';
        toolbar.append(
            this.button('Refresh', async () => {
                show(await (await this.request('dns')).json());
                this.status.textContent = '';
            }),
        );
        const apply = this.button('Apply Private DNS', async () => {
            if (
                !window.confirm(
                    t('Apply these Private DNS settings to the Shield? This can affect its network access.'),
                )
            ) {
                this.status.textContent = '';
                return;
            }
            show(await (await this.request('dns', { mode: mode.value, hostname: hostname.value.trim() })).json());
            this.status.textContent =
                'Settings saved and read back. TLS validation may take a few seconds; refresh to check.';
        });
        const test = this.button('Test DNS', async () => {
            const data = await (
                await this.request('dns-test', { domain: domain.value.trim(), server: server.value.trim() })
            ).json();
            if (this.disposed) return;
            const origin = document.createElement('p');
            origin.textContent =
                data.origin === 'device' ? 'Test origin: Shield' : 'Test origin: Shield Controller server';
            const output = document.createElement('pre');
            output.style.whiteSpace = 'pre-wrap';
            output.textContent =
                `${data.domain}\n` +
                data.results
                    .map(
                        (row: { family: string; addresses: string[]; error: string | null }) =>
                            `${row.family}: ${row.addresses.join(', ') || row.error || '—'}`,
                    )
                    .join('\n');
            results.replaceChildren(origin, output);
            this.status.textContent = '';
        });
        const internetNote = document.createElement('p');
        internetNote.textContent =
            'External test (IPleak.net): queries originate on the Shield and reveal its public IPv4/IPv6 and the recursive DNS resolvers observed for this test. This does not list root servers or every upstream setting. Apps and VPNs may use different routes.';
        const internetResult = document.createElement('pre');
        internetResult.style.whiteSpace = 'pre-wrap';
        const internetStatus = document.createElement('p');
        internetStatus.setAttribute('role', 'status');
        const detectInternet = async (): Promise<void> => {
            internetStatus.textContent = 'Testing from Shield… This can take up to 40 seconds.';
            try {
                let pending = internetTests.get(this.serial);
                if (!pending) {
                    pending = this.request('internet', {}).then(
                        (response) => response.json() as Promise<InternetResult>,
                    );
                    internetTests.set(this.serial, pending);
                }
                let data: InternetResult;
                try {
                    data = await pending;
                } finally {
                    if (internetTests.get(this.serial) === pending) internetTests.delete(this.serial);
                }
                if (this.disposed) return;
                internetResult.textContent =
                    `${data.provider} · ${data.testedAt}\n` +
                    data.results
                        .map(
                            (row: { family: string; address: string | null; error: string | null }) =>
                                `${row.family}: ${row.address || row.error}`,
                        )
                        .join('\n') +
                    '\nDNS:\n' +
                    (data.resolverDetails
                        .map(
                            (row: { address: string; provider: string | null; source: string }) =>
                                `${row.address} — ${row.provider || t('Unknown provider')}${row.source === 'network-owner' ? ` · ${t('Network operator')}` : ''}`,
                        )
                        .join('\n') || '—');
                internetStatus.textContent = 'Network test completed on the Shield.';
            } catch (error) {
                if (!this.disposed) internetStatus.textContent = error instanceof Error ? error.message : String(error);
            }
        };
        this.bodyEl.append(internetNote, internetStatus, internetResult);
        void detectInternet();
        this.bodyEl.append(toolbar, stateOutput, note, mode, hostname, apply, testNote, domain, server, test, results);
        try {
            show(await (await this.request('dns')).json());
        } catch (error) {
            this.status.textContent = String(error);
        }
    }
}
