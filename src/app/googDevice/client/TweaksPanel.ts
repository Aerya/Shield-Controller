import { t } from '../../client/Language';

interface Tweak {
    id: string;
    values: string[];
    supported: boolean;
    value: string | null;
    changed: boolean;
    original: string | null;
}
interface Snapshot {
    sdk: number;
    user: number;
    tweaks: Tweak[];
    density: { physical: number | null; override: number | null; min: number; max: number; changed: boolean };
    launcher: { home: string | null; launchers: string[]; changed: boolean };
}

// Labels are English i18n keys; value labels default to the raw value when not listed.
export const TWEAK_TEXT: Record<string, { name: string; help: string; labels?: Record<string, string> }> = {
    hdmi_cec: {
        name: 'HDMI-CEC',
        help: 'Lets the TV remote and the Shield control each other over HDMI.',
        labels: { '0': 'Off', '1': 'On' },
    },
    cec_auto_wakeup: {
        name: 'Turn on the TV with the Shield',
        help: 'Wakes the TV over HDMI-CEC when the Shield wakes up.',
        labels: { '0': 'Off', '1': 'On' },
    },
    cec_auto_off: {
        name: 'Turn off the TV with the Shield',
        help: 'Puts the TV in standby over HDMI-CEC when the Shield goes to sleep.',
        labels: { '0': 'Off', '1': 'On' },
    },
    match_frame_rate: {
        name: 'Match content frame rate',
        help: 'Android 12+ only. On the Shield, use the NVIDIA frame rate setting in the TV menu.',
        labels: { '0': 'Never', '1': 'Seamless only', '2': 'Always' },
    },
    long_press: {
        name: 'Long-press delay',
        help: 'Time to hold a remote button before it counts as a long press.',
        labels: { '400': 'Short (400 ms)', '1000': 'Medium (1 s)', '1500': 'Long (1.5 s)' },
    },
    window_animation_scale: {
        name: 'Window animation scale',
        help: 'Lower values make menus feel faster. 0 disables the animation.',
    },
    transition_animation_scale: {
        name: 'Transition animation scale',
        help: 'Lower values make screen changes feel faster. 0 disables the animation.',
    },
    animator_duration_scale: {
        name: 'Animator duration scale',
        help: 'Lower values speed up in-app animations. 0 can break some app animations.',
    },
    surround: {
        name: 'Surround sound output',
        help: 'How Android sends Dolby and DTS audio to the TV or receiver.',
        labels: { '0': 'Automatic', '1': 'Never', '2': 'Always', '3': 'Manual' },
    },
};

export class TweaksPanel {
    private disposed = false;
    private pending = false;
    constructor(
        private readonly container: HTMLElement,
        private readonly serial: string,
    ) {
        container.classList.add('optimization-panel');
        void this.refresh();
    }
    dispose(): void {
        this.disposed = true;
    }
    private async request(body?: unknown): Promise<Snapshot> {
        const response = await fetch(
            `/api/manager/tweaks?serial=${encodeURIComponent(this.serial)}`,
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
        if (this.disposed || this.pending) return;
        this.pending = true;
        this.container.textContent = t('Loading…');
        try {
            const data = await this.request();
            if (!this.disposed) this.render(data);
        } catch (error) {
            if (!this.disposed) {
                this.container.textContent = String(error);
                const retry = document.createElement('button');
                retry.textContent = t('Refresh');
                retry.onclick = () => void this.refresh();
                this.container.append(retry);
            }
        } finally {
            this.pending = false;
        }
    }
    private async apply(status: HTMLElement, id: string, value: string | null): Promise<void> {
        if (this.pending) return;
        this.pending = true;
        for (const control of this.container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select'))
            control.disabled = true;
        status.textContent = t('Loading…');
        try {
            await this.request({ id, value });
            this.pending = false;
            await this.refresh();
        } catch (error) {
            this.pending = false;
            if (!this.disposed) {
                status.textContent = String(error);
                for (const control of this.container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
                    'button, select',
                ))
                    control.disabled = false;
            }
        }
    }
    private row(name: string, help: string, control: HTMLElement, restore?: HTMLButtonElement): HTMLElement {
        const row = document.createElement('div');
        row.className = 'manager-app';
        const details = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = name;
        const explanation = document.createElement('p');
        explanation.className = 'optimization-explanation';
        explanation.textContent = help;
        details.append(title, explanation);
        const actions = document.createElement('div');
        actions.className = 'optimization-actions';
        actions.append(control);
        if (restore) actions.append(restore);
        row.append(details, actions);
        return row;
    }
    private restoreButton(status: HTMLElement, id: string, changed: boolean): HTMLButtonElement | undefined {
        if (!changed) return undefined;
        const button = document.createElement('button');
        button.textContent = t('Restore original');
        button.onclick = () => void this.apply(status, id, null);
        return button;
    }
    private render(data: Snapshot): void {
        this.container.replaceChildren();
        const heading = document.createElement('h2');
        heading.textContent = t('Settings and tweaks');
        const note = document.createElement('p');
        note.textContent = t(
            'Each change is applied immediately over ADB and verified. The first value seen before a change is kept on this server, so Restore original puts it back.',
        );
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const refresh = document.createElement('button');
        refresh.textContent = t('Refresh');
        refresh.onclick = () => void this.refresh();
        const meta = document.createElement('p');
        meta.textContent = `Android SDK ${data.sdk} · ${t('Android user')}: ${data.user}`;
        this.container.append(heading, note, meta, refresh, status);

        const list = document.createElement('div');
        list.className = 'optimization-list';
        for (const tweak of data.tweaks) {
            const text = TWEAK_TEXT[tweak.id] ?? { name: tweak.id, help: '' };
            const select = document.createElement('select');
            select.setAttribute('aria-label', t(text.name));
            const current = document.createElement('option');
            current.value = '';
            current.textContent = tweak.value === null ? t('Android default') : tweak.value;
            current.disabled = true;
            select.append(current);
            for (const value of tweak.values) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text.labels?.[value] ? t(text.labels[value]) : `${value}×`;
                select.append(option);
            }
            select.value = tweak.value !== null && tweak.values.includes(tweak.value) ? tweak.value : '';
            select.disabled = !tweak.supported;
            select.onchange = () => void this.apply(status, tweak.id, select.value);
            const help = tweak.supported ? t(text.help) : t('Not available on this Android version.');
            list.append(this.row(t(text.name), help, select, this.restoreButton(status, tweak.id, tweak.changed)));
        }

        const density = document.createElement('div');
        density.className = 'optimization-actions';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(data.density.min);
        input.max = String(data.density.max);
        input.step = '8';
        input.value = String(data.density.override ?? data.density.physical ?? '');
        input.setAttribute('aria-label', t('Display density (dpi)'));
        const applyDensity = document.createElement('button');
        applyDensity.textContent = t('Apply');
        applyDensity.onclick = () => {
            if (
                window.confirm(
                    t(
                        'A wrong density can make the interface hard to read. You can reset it from this panel at any time. Apply?',
                    ),
                )
            )
                void this.apply(status, 'density', input.value);
        };
        const resetDensity = document.createElement('button');
        resetDensity.textContent = t('Reset');
        resetDensity.onclick = () => void this.apply(status, 'density', 'reset');
        density.append(input, applyDensity, resetDensity);
        list.append(
            this.row(
                t('Display scaling (density)'),
                `${t('Physical')}: ${data.density.physical ?? '?'} dpi · ${t('Override')}: ${data.density.override ?? t('none')}. ${t('Lower values show more content, higher values enlarge it.')}`,
                density,
                this.restoreButton(status, 'density', data.density.changed),
            ),
        );

        const launcher = document.createElement('select');
        launcher.setAttribute('aria-label', t('Default launcher'));
        if (!data.launcher.home) {
            const unknown = document.createElement('option');
            unknown.value = '';
            unknown.textContent = t('Not set (Android asks)');
            unknown.disabled = true;
            launcher.append(unknown);
        }
        for (const component of data.launcher.launchers) {
            const option = document.createElement('option');
            option.value = component;
            option.textContent = component.split('/')[0]!;
            launcher.append(option);
        }
        launcher.value = data.launcher.home ?? '';
        launcher.disabled = data.launcher.launchers.length < 2;
        launcher.onchange = () => void this.apply(status, 'launcher', launcher.value);
        list.append(
            this.row(
                t('Default launcher'),
                t(
                    'Installed home screens. Install another launcher as an APK first. The stock launcher stays installed; disable it from Optimization only if you are sure.',
                ),
                launcher,
                this.restoreButton(status, 'launcher', data.launcher.changed),
            ),
        );
        this.container.append(list);
        const dns = document.createElement('p');
        dns.textContent = t('Private DNS is in the DNS / IPv4 / IPv6 panel.');
        this.container.append(dns, this.snapshotSection(data.user));
    }
    private async post(endpoint: string, body: unknown): Promise<any> {
        const response = await fetch(`/api/manager/${endpoint}?serial=${encodeURIComponent(this.serial)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(t(data.error ?? `HTTP ${response.status}`));
        return data;
    }
    private snapshotSection(user: number): HTMLElement {
        const section = document.createElement('section');
        section.className = 'optimization-diagnostics';
        const title = document.createElement('h3');
        title.textContent = t('Snapshot');
        const note = document.createElement('p');
        note.textContent = t(
            'Save which apps are enabled or disabled, the settings above, density and launcher to a file. Load it later on this device to roll back, or on another one to copy the setup. Only differences are applied, after a preview.',
        );
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        const save = document.createElement('button');
        save.textContent = t('Save snapshot');
        save.onclick = async () => {
            status.textContent = t('Loading…');
            try {
                const response = await fetch(`/api/manager/snapshot?serial=${encodeURIComponent(this.serial)}`);
                const snapshot = await response.json();
                if (!response.ok) throw new Error(t(snapshot.error ?? `HTTP ${response.status}`));
                const link = document.createElement('a');
                link.href = URL.createObjectURL(
                    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
                );
                const name = String(snapshot.model || 'device').replace(/[^\w.-]+/g, '-');
                link.download = `shield-snapshot-${name}-${snapshot.createdAt.slice(0, 10)}.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                status.textContent = '';
            } catch (error) {
                status.textContent = String(error);
            }
        };
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'application/json,.json';
        file.setAttribute('aria-label', t('Load snapshot'));
        const preview = document.createElement('div');
        file.onchange = async () => {
            preview.replaceChildren();
            const selected = file.files?.[0];
            if (!selected) return;
            status.textContent = t('Loading…');
            try {
                let snapshot: unknown;
                try {
                    snapshot = JSON.parse(await selected.text());
                } catch {
                    throw new Error(t('Not a Shield Controller snapshot.'));
                }
                const plan = await this.post('snapshot-plan', { snapshot });
                status.textContent = '';
                this.renderPlan(preview, plan);
                if (!plan.steps.length) return;
                const apply = document.createElement('button');
                apply.textContent = t('Apply snapshot');
                apply.onclick = async () => {
                    if (!window.confirm(t('Apply these changes to this device?'))) return;
                    apply.disabled = true;
                    status.textContent = t('Loading…');
                    try {
                        const result = await this.post('snapshot-apply', { snapshot, user });
                        status.textContent = t('Snapshot applied. Refresh to see the new values.');
                        this.renderPlan(preview, result);
                    } catch (error) {
                        status.textContent = String(error);
                        apply.disabled = false;
                    }
                };
                preview.append(apply);
            } catch (error) {
                status.textContent = String(error);
            }
        };
        section.append(title, note, save, file, status, preview);
        return section;
    }
    private renderPlan(
        container: HTMLElement,
        plan: {
            model: string;
            createdAt: string;
            steps: { kind: string; target: string; from: string | null; to: string; result?: string }[];
            skipped: { target: string; reason: string }[];
        },
    ): void {
        container.replaceChildren();
        const source = document.createElement('p');
        source.textContent = `${t('Snapshot from')} ${plan.model || '?'} · ${new Date(plan.createdAt).toLocaleString()}`;
        container.append(source);
        if (!plan.steps.length) {
            const same = document.createElement('p');
            same.textContent = t('This device already matches the snapshot.');
            container.append(same);
        }
        const name = (target: string) => (TWEAK_TEXT[target] ? t(TWEAK_TEXT[target].name) : target);
        for (const step of plan.steps) {
            const row = document.createElement('p');
            const change =
                step.kind === 'enable' || step.kind === 'disable'
                    ? `${t(step.kind === 'enable' ? 'Enable' : 'Disable')} ${step.target}`
                    : `${name(step.target)}: ${step.from ?? t('Android default')} → ${step.to}`;
            row.textContent = step.result
                ? `${change} — ${t(step.result === 'success' ? 'Done' : step.result)}`
                : change;
            container.append(row);
        }
        for (const item of plan.skipped) {
            const row = document.createElement('p');
            row.textContent = `${t('Skipped')}: ${name(item.target)} — ${t(item.reason)}`;
            container.append(row);
        }
    }
}
