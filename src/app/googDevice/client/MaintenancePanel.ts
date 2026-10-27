import { t } from '../../client/Language';

interface Measurement {
    at: string;
    uptimeSeconds: number | null;
    availableKiB: number | null;
    cpuPercent: number | null;
}
interface Status {
    user: number;
    model: string;
    manufacturer: string;
    sdk: string;
    googleTv: boolean;
    home: string | null;
    launchers: string[];
    flagsAvailable: boolean;
    components: { packageName: string; role: string; protected: boolean; persistent: boolean }[];
    baselineAt: string | null;
    before: Measurement | null;
    detox: { version: string; installed: boolean };
}
interface Plan {
    revision: string;
    steps: { kind: string; target: string; from: string | null; to: string; result?: string }[];
    skipped: { target: string; reason: string }[];
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};

export class MaintenancePanel {
    private disposed = false;
    private pending = false;
    private data?: Status;
    private readonly message = el('p');
    private readonly result = el('div');
    constructor(
        private readonly container: HTMLElement,
        private readonly serial: string,
    ) {
        container.classList.add('optimization-section', 'maintenance-panel');
        this.message.setAttribute('role', 'status');
        this.message.setAttribute('aria-live', 'polite');
        void this.refresh();
    }
    dispose(): void {
        this.disposed = true;
    }
    private async request(body?: unknown): Promise<any> {
        const response = await fetch(
            `/api/manager/maintenance?serial=${encodeURIComponent(this.serial)}`,
            body === undefined
                ? {}
                : {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(body),
                  },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(t(data.error ?? `HTTP ${response.status}`));
        return data;
    }
    private async refresh(): Promise<void> {
        if (this.disposed) return;
        try {
            this.data = await this.request();
            if (!this.disposed) this.render();
        } catch (error) {
            if (this.disposed) return;
            this.container.replaceChildren(
                el('h3', t('TV maintenance')),
                this.message,
                this.button('Refresh', () => this.refresh()),
            );
            this.message.textContent = String(error);
        }
    }
    private button(label: string, run: () => Promise<void>): HTMLButtonElement {
        const button = el('button', t(label));
        button.type = 'button';
        button.onclick = async () => {
            if (this.pending || this.disposed) return;
            this.pending = true;
            const controls = [
                ...this.container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
                    'button,input,select,textarea',
                ),
            ];
            const disabled = controls.map((control) => control.disabled);
            controls.forEach((control) => {
                control.disabled = true;
            });
            this.message.textContent = t('Loading…');
            try {
                await run();
                if (!this.disposed) this.message.textContent = t('Done');
            } catch (error) {
                if (!this.disposed) this.message.textContent = String(error);
            } finally {
                this.pending = false;
                controls.forEach((control, i) => {
                    control.disabled = disabled[i]!;
                });
            }
        };
        return button;
    }
    private action(action: string, fields: Record<string, unknown> = {}): Promise<any> {
        return this.request({ action, user: this.data!.user, ...fields });
    }
    private section(title: string, note: string): HTMLElement {
        const section = el('section');
        section.className = 'optimization-section';
        section.append(el('h4', t(title)), el('p', t(note)));
        return section;
    }
    private render(): void {
        const data = this.data!;
        this.container.replaceChildren(
            el('h3', t('TV maintenance')),
            el('p', `${data.manufacturer} ${data.model} · SDK ${data.sdk} · ${t('Android user')}: ${data.user}`),
            this.message,
        );
        const compatibility = this.section(
            'Compatibility',
            data.googleTv
                ? 'Google TV detected. Keep its stock launcher and initial setup enabled.'
                : 'Compatibility is based on known components, not a guarantee for every firmware.',
        );
        compatibility.append(el('p', `${t('Default launcher')}: ${data.home ?? t('Unavailable')}`));
        if (!data.flagsAvailable)
            compatibility.append(
                el('p', t('Persistent component flags unavailable. Unknown applications are not classified as safe.')),
            );
        const details = el('details');
        details.append(el('summary', t('TV components and features')));
        for (const item of data.components)
            details.append(
                el(
                    'p',
                    `${item.packageName} — ${t(item.role)}${item.protected ? ` · ${t('Protected')}` : ''}${item.persistent ? ' · PERSISTENT' : ''}`,
                ),
            );
        compatibility.append(details);
        const baseline = this.section(
            'Reference configuration',
            'Save the current setup on this server. After an update, check for differences and select only the changes you want to restore.',
        );
        baseline.append(
            el(
                'p',
                data.baselineAt
                    ? `${t('Saved')}: ${new Date(data.baselineAt).toLocaleString()}`
                    : t('No reference configuration saved.'),
            ),
        );
        baseline.append(
            this.button('Save reference configuration', async () => {
                if (
                    data.baselineAt &&
                    !window.confirm(t('Replace the saved reference with the current configuration?'))
                )
                    return;
                await this.action('save-baseline');
                this.result.replaceChildren();
                await this.refresh();
            }),
        );
        const check = this.button('Check my configuration', async () => {
            this.renderPlan(await this.action('check'));
        });
        check.disabled = !data.baselineAt;
        baseline.append(check);
        const home = this.section(
            'Test Home button',
            'This opens Settings and presses Home on the TV, interrupting the current screen. It does not restart the device or disable applications.',
        );
        const launchers = el('select');
        launchers.setAttribute('aria-label', t('Expected launcher'));
        for (const component of data.launchers) {
            const option = el('option', component);
            option.value = component;
            launchers.append(option);
        }
        if (data.home && data.launchers.includes(data.home)) launchers.value = data.home;
        const restore = el('input');
        restore.type = 'checkbox';
        const restoreLabel = el('label');
        restoreLabel.append(
            restore,
            document.createTextNode(
                t('Restore the original launcher if the test fails (when recorded by Shield Controller).'),
            ),
        );
        home.append(
            launchers,
            restoreLabel,
            this.button('Test Home button', async () => {
                if (!window.confirm(t('Open Settings and press Home on the TV now?'))) return;
                const report = await this.action('home-test', {
                    expected: launchers.value,
                    restoreOnFailure: restore.checked,
                });
                this.result.replaceChildren(
                    el(
                        'p',
                        t(
                            report.success
                                ? 'Home opened the expected launcher.'
                                : 'Home did not open the expected launcher.',
                        ),
                    ),
                    el('p', `${t('Observed')}: ${report.actual ?? t('Unavailable')}`),
                );
                if (report.restored)
                    this.result.append(el('p', t('Original launcher restored. Run the test again to verify routing.')));
                if (report.restoreError) this.result.append(el('p', t(report.restoreError)));
            }),
        );
        const metrics = this.section(
            'Before and after',
            'Take both measurements under similar conditions. Available RAM and a one-second CPU sample do not prove a speed improvement. No automatic reboot or cleanup.',
        );
        if (data.before) metrics.append(this.measurement('Before', data.before));
        metrics.append(
            this.button('Measure before', async () => {
                if (data.before && !window.confirm(t('Replace the before measurement?'))) return;
                const report = await this.action('before');
                this.result.replaceChildren(this.measurement('Before', report.before));
                await this.refresh();
            }),
        );
        const after = this.button('Measure after', async () => {
            const report = await this.action('after');
            this.result.replaceChildren(
                this.measurement('Before', report.before),
                this.measurement('After', report.after),
            );
            this.result.append(
                el(
                    'p',
                    t(
                        report.sameBoot
                            ? 'Same boot. Workload differences can still affect the comparison.'
                            : 'Different or unknown boot. A reboot may explain the difference.',
                    ),
                ),
            );
            if (report.availableDeltaKiB !== null)
                this.result.append(
                    el('p', `${t('Available RAM difference')}: ${(report.availableDeltaKiB / 1024).toFixed(1)} MiB`),
                );
        });
        after.disabled = !data.before;
        metrics.append(after);
        this.container.append(compatibility, baseline, home, metrics, this.launcherSection(), this.result);
    }
    private measurement(label: string, measurement: Measurement): HTMLElement {
        const memory = measurement.availableKiB === null ? '?' : (measurement.availableKiB / 1024).toFixed(1);
        return el(
            'p',
            `${t(label)} · ${new Date(measurement.at).toLocaleString()} · ${t('Available RAM')}: ${memory} MiB · CPU: ${measurement.cpuPercent ?? '?'}% · ${t('Uptime')}: ${measurement.uptimeSeconds === null ? '?' : Math.round(measurement.uptimeSeconds / 60)} min`,
        );
    }
    private renderPlan(plan: Plan): void {
        this.result.replaceChildren(el('h4', t('Configuration differences')));
        const selected = new Set<string>();
        for (const step of plan.steps) {
            const label = el('label');
            const box = el('input');
            box.type = 'checkbox';
            box.disabled = !!step.result;
            const id = `${step.kind}:${step.target}`;
            box.onchange = () => {
                if (box.checked) selected.add(id);
                else selected.delete(id);
            };
            label.append(
                box,
                document.createTextNode(
                    `${t(step.kind)} ${step.target}: ${step.from ?? '?'} → ${step.to}${step.result ? ` — ${t(step.result)}` : ''}`,
                ),
            );
            this.result.append(label);
        }
        if (!plan.steps.length)
            this.result.append(el('p', t('No actionable differences. Check any skipped items below.')));
        for (const skip of plan.skipped)
            this.result.append(el('p', `${t('Skipped')}: ${skip.target} — ${t(skip.reason)}`));
        if (plan.steps.some((step) => !step.result))
            this.result.append(
                this.button('Restore selected differences', async () => {
                    if (!selected.size) throw new Error(t('Select differences to restore.'));
                    if (!window.confirm(t('Apply only the selected changes to this device?'))) return;
                    const result = await this.action('repair', { selected: [...selected], revision: plan.revision });
                    this.renderPlan({ ...result, revision: plan.revision });
                }),
            );
    }
    private launcherSection(): HTMLElement {
        const data = this.data!;
        const section = this.section(
            'Optional TV Detox launcher',
            'A separate Android home screen, installed only on request. The stock launcher remains enabled. Choose the default launcher in Settings and tweaks after installation.',
        );
        const source = el('a', `TV Detox ${data.detox.version} · GitHub`);
        source.href = 'https://github.com/Ansub/tv-detox';
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        section.append(
            source,
            el(
                'p',
                t(
                    'Pinned release with SHA-256 verification. Signature conflicts are reported without uninstalling the existing app.',
                ),
            ),
        );
        const install = this.button(
            data.detox.installed ? 'Reinstall pinned launcher' : 'Install TV Detox',
            async () => {
                if (!window.confirm(t('Download and install the pinned TV Detox APK on this TV?'))) return;
                await this.action('install-detox');
                await this.refresh();
            },
        );
        install.disabled = data.user !== 0;
        section.append(install);
        if (data.user !== 0) section.append(el('p', t('Launcher installation is available for Android user 0 only.')));
        if (!data.detox.installed) return section;
        const apps = el('textarea');
        apps.rows = 3;
        apps.setAttribute('aria-label', t('Launcher applications in order'));
        const appsLabel = el(
            'label',
            t('Package names in display order, separated by commas. Empty means automatic selection.'),
        );
        appsLabel.append(apps);
        section.append(appsLabel);
        const shortcuts = ['bluetooth', 'sound', 'picture'].map((name) => {
            const input = el('input');
            input.type = 'checkbox';
            input.value = name;
            const label = el('label');
            label.append(input, document.createTextNode(t(name)));
            section.append(label);
            return input;
        });
        const clock = el('select');
        clock.setAttribute('aria-label', t('Clock format'));
        for (const value of ['auto', '12', '24']) {
            const option = el('option', value === 'auto' ? t('Automatic') : `${value} h`);
            option.value = value;
            clock.append(option);
        }
        section.append(
            clock,
            this.button('Configure and open TV Detox', async () => {
                if (!window.confirm(t('Save this layout and open TV Detox on the TV?'))) return;
                await this.action('configure-detox', {
                    apps: apps.value
                        .split(/[,\n]/)
                        .map((p) => p.trim())
                        .filter(Boolean),
                    quick: shortcuts.filter((box) => box.checked).map((box) => box.value),
                    clock: clock.value,
                });
                this.result.replaceChildren(el('p', t('Configuration sent. Check the layout on the TV.')));
            }),
        );
        return section;
    }
}
