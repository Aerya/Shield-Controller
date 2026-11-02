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
    profile?: { model: string | null; notes: string[] };
    cleanLauncher?: { version: string; installed: boolean; minSdk: number };
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
        if (data.profile) {
            compatibility.append(el('h4', t('Model profile')), el('p', data.profile.model ?? t('Unavailable')));
            for (const note of data.profile.notes) compatibility.append(el('p', t(note)));
        }
        this.container.append(
            compatibility,
            baseline,
            home,
            this.recoverySection(),
            this.remoteSection(),
            metrics,
            this.diagnosticsSection(),
            this.launcherSection(),
        );
        if (data.cleanLauncher) this.container.append(this.cleanLauncherSection());
        this.container.append(this.result);
    }
    private recoverySection(): HTMLElement {
        const section = this.section(
            'Home still opens the stock launcher',
            'Diagnose first. An alternative must open successfully before the supported stock launcher can be disabled. The original state is saved for restoration.',
        );
        const body = el('div');
        section.append(
            this.button('Diagnose launcher routing', async () => {
                const report = await this.action('launcher-diagnose');
                body.replaceChildren(el('p', `${t('Default launcher')}: ${report.home ?? t('Unavailable')}`));
                if (report.recovery) {
                    body.append(
                        el('p', `${t('Saved recovery')}: ${report.recovery.stock}`),
                        this.button('Restore stock launcher', async () => {
                            if (!window.confirm(t('Re-enable the saved stock launcher and restore the previous Home?')))
                                return;
                            await this.action('launcher-restore', { confirmed: true });
                            body.replaceChildren(
                                el('p', t('Original launcher restored. Run the test again to verify routing.')),
                            );
                        }),
                    );
                    return;
                }
                const target = el('select');
                target.setAttribute('aria-label', t('Alternative launcher'));
                for (const value of report.launchers as string[]) {
                    if (/^com.google.android.(tvlauncher|apps.tv.launcherx)\//.test(value)) continue;
                    const option = el('option', value);
                    option.value = value;
                    target.append(option);
                }
                const stock = el('select');
                stock.setAttribute('aria-label', t('Stock launcher to disable'));
                for (const value of report.candidates as string[]) {
                    const option = el('option', value);
                    option.value = value;
                    stock.append(option);
                }
                if (!target.options.length || !stock.options.length) {
                    body.append(
                        el('p', t('No supported launcher replacement available. Keep the current launcher enabled.')),
                    );
                    return;
                }
                body.append(
                    el('label', t('Alternative launcher')),
                    target,
                    el('p', t('Stock launcher to disable')),
                    stock,
                    this.button('Verify alternative and replace Home', async () => {
                        if (
                            !window.confirm(
                                `${t('Open the alternative, disable the selected stock launcher and test Home? This interrupts the TV.')}\n${target.value}\n${stock.value}`,
                            )
                        )
                            return;
                        await this.action('launcher-recover', {
                            target: target.value,
                            stock: stock.value,
                            confirmed: true,
                        });
                        body.replaceChildren(el('p', t('Home verified. Diagnose again to access restoration.')));
                    }),
                );
            }),
            body,
        );
        return section;
    }
    private remoteSection(): HTMLElement {
        const section = this.section(
            'Remote button mapping',
            'Optional companion on the TV. Enable its accessibility service on the TV, then configure buttons here. Power, volume and directional navigation remain unchanged. Home and special buttons depend on firmware.',
        );
        if (/nvidia/i.test(this.data!.manufacturer)) {
            section.append(
                el(
                    'p',
                    t(
                        'For the native Menu button: Remotes & accessories → Customize Menu button. The shortcut opens Bluetooth settings; navigate to the parent menu if necessary.',
                    ),
                ),
                this.button('Open remote and accessory settings', async () => {
                    if (!window.confirm(t('Open TV settings now?'))) return;
                    await this.action('remote-native');
                }),
            );
        }
        const body = el('div');
        const load = async () => this.renderRemote(body, await this.action('remote-status'));
        section.append(this.button('Load remote configuration', load), body);
        return section;
    }
    private renderRemote(
        body: HTMLElement,
        state: {
            installed: boolean;
            appVersion?: number;
            registered?: boolean;
            enabled?: boolean;
            active: boolean;
            lastKey?: number;
            lastAt?: number;
            lastError?: string;
            bindings: { key: number; tap: string; hold: string | null; double: string | null }[];
            apps: { packageName: string; label: string }[];
        },
    ): void {
        body.replaceChildren();
        const install = this.button(
            state.installed ? 'Update remote companion' : 'Install remote companion',
            async () => {
                if (!window.confirm(t('Install the bundled remote companion APK? Existing mappings are preserved.')))
                    return;
                this.renderRemote(body, await this.action('remote-install', { confirmed: true }));
            },
        );
        install.disabled = this.data!.user !== 0 || Number(this.data!.sdk) < 26;
        body.append(install);
        if (!state.installed) return;
        body.append(
            el(
                'p',
                t(
                    state.active
                        ? 'Remote service connected.'
                        : 'Remote service disconnected. Enable it in TV accessibility settings.',
                ),
            ),
            this.button('Open companion setup', async () => {
                if (!window.confirm(t('Open companion setup on the TV now?'))) return;
                await this.action('remote-setup');
            }),
        );
        body.append(
            el(
                'p',
                t(
                    'If the TV says no app can handle accessibility settings, use the confirmed ADB activation below. Other accessibility services are preserved.',
                ),
            ),
        );
        if ((state.appVersion ?? 0) < 2) {
            body.append(el('p', t('Update the remote companion to use ADB activation and detailed status.')));
        } else {
            body.append(
                el(
                    'p',
                    `${t('Service registered')}: ${t(state.registered ? 'Yes' : 'No')} · ${t('Enabled in Android')}: ${t(state.enabled ? 'Yes' : 'No')}`,
                ),
            );
            if (state.enabled && !state.active)
                body.append(
                    el(
                        'p',
                        t(
                            'Enabled but not connected. Android has not bound the service. Check restricted settings or another key-filtering service; activation alone does not prove that buttons work.',
                        ),
                    ),
                );
            const enabled = !!state.enabled;
            const toggle = this.button(
                enabled ? 'Disable remote service (ADB)' : 'Enable remote service (ADB)',
                async () => {
                    if (
                        !window.confirm(
                            t(
                                enabled
                                    ? 'Disable only Shield Controller Remote? Other accessibility services and saved mappings are preserved.'
                                    : 'Enable Shield Controller Remote through ADB? It can intercept supported remote keys and perform the configured actions. Other accessibility services are preserved.',
                            ),
                        )
                    )
                        return;
                    this.renderRemote(
                        body,
                        await this.action('remote-accessibility', { enabled: !enabled, confirmed: true }),
                    );
                },
            );
            toggle.disabled = state.registered !== true;
            body.append(toggle);
        }
        body.append(
            el(
                'p',
                t(
                    'Press a supported remote button, then refresh to see its code. Only the last supported button is retained in memory; no text is captured.',
                ),
            ),
            el(
                'p',
                `${t('Last observed button')}: ${state.lastKey || t('Unavailable')}${state.lastAt ? ` · ${new Date(state.lastAt).toLocaleTimeString()}` : ''}`,
            ),
            this.button('Refresh remote status', async () => {
                if (!window.confirm(t('Reload saved mappings? Unsaved edits will be lost.'))) return;
                this.renderRemote(body, await this.action('remote-status'));
            }),
        );
        if (state.lastError) body.append(el('p', `${t('Last action error')}: ${state.lastError}`));
        const keys: [number, string][] = [
            [3, 'Home'],
            [4, 'Back'],
            [82, 'Menu'],
            [84, 'Search'],
            [85, 'Play / pause'],
            [86, 'Stop'],
            [87, 'Next'],
            [88, 'Previous'],
            [89, 'Rewind'],
            [90, 'Fast forward'],
            [126, 'Play'],
            [127, 'Pause'],
            [172, 'Guide'],
            [183, 'Red'],
            [184, 'Green'],
            [185, 'Yellow'],
            [186, 'Blue'],
            [187, 'App switch'],
            [188, 'Button 1'],
            [189, 'Button 2'],
            [190, 'Button 3'],
        ];
        const rows = el('div');
        const editors: {
            card: HTMLElement;
            key: HTMLSelectElement;
            tap: HTMLSelectElement;
            hold: HTMLSelectElement;
            double: HTMLSelectElement;
        }[] = [];
        const actionSelect = (label: string, value: string | null, optional: boolean) => {
            const select = el('select');
            select.setAttribute('aria-label', t(label));
            const options: [string, string][] = optional ? [['', 'Not configured']] : [];
            options.push(
                ['home', 'Home'],
                ['back', 'Back'],
                ['recents', 'Recent apps'],
                ['notifications', 'Notifications'],
                ['none', 'Do nothing'],
            );
            for (const app of state.apps) options.push([`app:${app.packageName}`, `${app.label} (${app.packageName})`]);
            if (value && !options.some(([id]) => id === value)) options.push([value, `${t('Unavailable')}: ${value}`]);
            for (const [id, name] of options) {
                const option = el('option', t(name));
                option.value = id;
                select.append(option);
            }
            select.value = value ?? '';
            return select;
        };
        const add = (binding?: (typeof state.bindings)[number]) => {
            if (editors.length >= 20) throw new Error(t('Maximum 20 button mappings.'));
            const card = el('section');
            card.className = 'optimization-section remote-mapping-row';
            const key = el('select');
            key.setAttribute('aria-label', t('Remote button'));
            for (const [code, name] of keys) {
                const option = el('option', `${t(name)} (${code})`);
                option.value = String(code);
                key.append(option);
            }
            key.value = String(
                binding?.key ?? (state.lastKey && keys.some(([code]) => code === state.lastKey) ? state.lastKey : 82),
            );
            const tap = actionSelect('Short press', binding?.tap ?? 'home', false);
            const hold = actionSelect('Long press (600 ms)', binding?.hold ?? null, true);
            const twice = actionSelect('Double press (300 ms)', binding?.double ?? null, true);
            for (const [label, control] of [
                ['Remote button', key],
                ['Short press', tap],
                ['Long press (600 ms)', hold],
                ['Double press (300 ms)', twice],
            ] as const) {
                const wrapper = el('label', t(label));
                wrapper.append(control);
                card.append(wrapper);
            }
            const editor = { card, key, tap, hold, double: twice };
            editors.push(editor);
            card.append(
                this.button('Remove mapping', async () => {
                    editors.splice(editors.indexOf(editor), 1);
                    card.remove();
                }),
            );
            rows.append(card);
        };
        for (const binding of state.bindings) add(binding);
        body.append(
            rows,
            this.button('Add button mapping', async () => add()),
            el(
                'p',
                t(
                    'A short press action is required for each mapped button. Double press delays the short action by 300 ms. Removing a mapping restores normal handling.',
                ),
            ),
            this.button('Save button mappings', async () => {
                if (!window.confirm(t('Apply these mappings on the TV?'))) return;
                const bindings = editors.map((row) => ({
                    key: Number(row.key.value),
                    tap: row.tap.value,
                    hold: row.hold.value || null,
                    double: row.double.value || null,
                }));
                this.renderRemote(body, await this.action('remote-save', { confirmed: true, bindings }));
            }),
            this.button('Reset all button mappings', async () => {
                if (!window.confirm(t('Remove all mappings and restore normal button handling?'))) return;
                this.renderRemote(body, await this.action('remote-save', { confirmed: true, bindings: [] }));
            }),
        );
    }

    private exportReport(report: unknown): HTMLButtonElement {
        return this.button('Download report', async () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
            const link = el('a');
            link.href = url;
            link.download = 'tv-diagnostics.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    private diagnosticsSection(): HTMLElement {
        const section = this.section(
            'Privacy and launcher performance',
            'Privacy audit is read-only. A permission or a name match does not prove recording or tracking. Missing Android evidence is reported as unknown.',
        );
        section.append(
            this.button('Audit privacy', async () => {
                const report = await this.action('privacy');
                this.result.replaceChildren(el('h4', t('Privacy audit')));
                if (!report.entries.length)
                    this.result.append(el('p', t('No known candidates found. This is not a privacy guarantee.')));
                for (const item of report.entries) {
                    const card = el('section');
                    card.className = 'optimization-section';
                    const state = (v: boolean | null) => t(v === null ? 'Unknown' : v ? 'Yes' : 'No');
                    card.append(
                        el('h4', item.packageName),
                        el('p', `${t(item.category)} — ${t(item.note)}`),
                        el('p', `${t('Declared microphone permission')}: ${state(item.declared)}`),
                        el('p', `${t('Microphone access in returned history')}: ${state(item.accessed)}`),
                    );
                    if (item.nominated) card.append(el('p', t('Voice service selected by Android.')));
                    if (item.sharedSystemUid)
                        card.append(
                            el('p', t('Shared system UID: microphone access cannot be attributed to this package.')),
                        );
                    this.result.append(card);
                }
                this.result.append(
                    el('p', `${t('Candidates not inspected')}: ${report.skipped}`),
                    this.exportReport(report),
                );
            }),
        );
        section.append(
            el(
                'p',
                t(
                    'Benchmark interrupts the TV, moves focus, stops and restarts the launcher. Save current work first. Timings are Android measurements, not physical remote latency.',
                ),
            ),
            this.button('Benchmark launcher', async () => {
                if (!window.confirm(t('Interrupt the TV and stop/restart its launcher for the benchmark?'))) return;
                const report = await this.action('benchmark', { confirmed: true });
                this.result.replaceChildren(el('h4', t('Launcher benchmark')));
                for (const [label, sample] of [
                    ['Before', report.before],
                    ['After', report.after],
                ] as const) {
                    if (!sample) continue;
                    const card = el('section');
                    card.className = 'optimization-section';
                    const value = (v: number | null, unit: string) => (v === null ? t('Unavailable') : `${v} ${unit}`);
                    card.append(
                        el('h4', t(label)),
                        el('p', `${sample.home} · ${new Date(sample.at).toLocaleString()}`),
                        el('p', `${t('Cold start')}: ${value(sample.coldMs, 'ms')}`),
                        el('p', `${t('Return to Home')}: ${value(sample.homeMs, 'ms')}`),
                        el(
                            'p',
                            `${t('Rendered frames / janky frames')}: ${sample.frames ?? '?'} / ${sample.janky ?? '?'}`,
                        ),
                        el('p', `PSS: ${value(sample.pssKiB, 'KiB')}`),
                    );
                    this.result.append(card);
                }
                this.result.append(
                    el(
                        'p',
                        t(
                            'The previous run is retained for comparison. Use the same workload; different launchers or firmware may not provide comparable counters.',
                        ),
                    ),
                    this.exportReport(report),
                );
            }),
        );
        return section;
    }
    private cleanLauncherSection(): HTMLElement {
        const data = this.data!;
        const launcher = data.cleanLauncher!;
        const section = this.section(
            'Optional CleanYourTV launcher',
            'Bundled source-built APK with SHA-256 verification. Installation keeps the stock launcher enabled. Themes, dock, app order and modules are configured in the launcher on the TV.',
        );
        section.append(el('p', `CleanYourTV ${launcher.version} · Android 8+`));
        const install = this.button('Install CleanYourTV', async () => {
            if (!window.confirm(t('Install the bundled CleanYourTV APK on this TV?'))) return;
            await this.action('install-clean');
            await this.refresh();
        });
        install.disabled = data.user !== 0 || !/^\d+$/.test(data.sdk) || Number(data.sdk) < launcher.minSdk;
        section.append(install);
        if (install.disabled) section.append(el('p', t('Installation requires Android 8+ and Android user 0.')));
        if (launcher.installed)
            section.append(
                this.button('Open CleanYourTV', async () => {
                    if (!window.confirm(t('Open CleanYourTV on the TV now?'))) return;
                    await this.action('open-clean');
                }),
            );
        section.append(
            el(
                'p',
                t(
                    'Choose the default launcher in Settings and tweaks, then test Home. Signature conflicts never trigger an uninstall.',
                ),
            ),
        );
        return section;
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
