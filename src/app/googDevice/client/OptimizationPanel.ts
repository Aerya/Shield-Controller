import { t } from '../../client/Language';
import { optimizationDescription } from './OptimizationCatalog';

interface App {
    packageName: string;
    system: boolean | null;
    disabled: boolean;
    category: string;
    protection: string | null;
    manual: boolean;
    recommendation: 'recommended' | 'optional' | null;
}
interface Snapshot {
    user: number;
    reliable: boolean;
    apps: App[];
    processes: string;
    memory: string;
    storage: string;
    history: { at: string; packageName: string; action: string; result: string; user: number }[];
}
export class OptimizationPanel {
    private disposed = false;
    private pending = false;
    private query = '';
    private category = 'focused';
    private page = 0;
    private readonly pageSize = 12;
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
            `/api/manager/optimization?serial=${encodeURIComponent(this.serial)}`,
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
    private render(data: Snapshot): void {
        this.container.replaceChildren();
        const note = document.createElement('p');
        note.textContent = t(
            'Manual actions only. Disabling preserves app data but stops its functions. Re-enable it here to restore access. No Plex database changes.',
        );
        const guidance = document.createElement('p');
        guidance.textContent = t(
            'Telemetry and diagnostics: disabling may stop reporting and support tools. Local Plex server: disable only if this Shield does not host your libraries. Other system apps may provide TV functions; a category is not a recommendation to disable.',
        );
        const protectionNote = document.createElement('p');
        protectionNote.textContent = t(
            'The active launcher, foreground app and media sessions are protected. Protect your usual player manually to keep it protected when closed.',
        );
        const status = document.createElement('p');
        status.setAttribute('role', 'status');
        if (!data.reliable)
            status.textContent = t('Protection detection unavailable. Refresh diagnostics before disabling.');
        const user = document.createElement('p');
        user.textContent = `${t('Android user')}: ${data.user}`;
        const toolbar = document.createElement('div');
        toolbar.className = 'manager-toolbar';
        const refresh = document.createElement('button');
        refresh.textContent = t('Refresh');
        refresh.onclick = () => void this.refresh();
        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = t('Search applications');
        search.setAttribute('aria-label', t('Search applications'));
        search.value = this.query;
        const filter = document.createElement('select');
        filter.setAttribute('aria-label', t('Filter applications'));
        for (const value of [
            'focused',
            'all',
            'system',
            'user',
            'disabled',
            'protected',
            'Telemetry / feedback',
            'NVIDIA diagnostics',
            'Local Plex server',
            'Plex player',
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = t(
                (
                    {
                        focused: 'Everyday optimization',
                        all: 'Advanced — all applications',
                        system: 'System components',
                        user: 'User apps',
                    } as Record<string, string>
                )[value] ?? value,
            );
            filter.append(option);
        }
        filter.value = this.category;
        const list = document.createElement('div');
        list.className = 'optimization-list';
        const pagination = document.createElement('nav');
        pagination.className = 'manager-toolbar optimization-pagination';
        pagination.setAttribute('aria-label', t('Application pages'));
        const count = document.createElement('span');
        count.setAttribute('role', 'status');
        const previous = document.createElement('button');
        previous.textContent = t('Previous');
        const next = document.createElement('button');
        next.textContent = t('Next');
        previous.onclick = () => {
            this.page--;
            renderApps();
        };
        next.onclick = () => {
            this.page++;
            renderApps();
        };
        pagination.append(previous, count, next);
        const focusedNote = document.createElement('p');
        focusedNote.className = 'optimization-view-note';

        const change = async (app: App, action: string): Promise<void> => {
            if (this.pending) return;
            const warning =
                app.category === 'Local Plex server'
                    ? t('This stops libraries and streams hosted by this Shield. The Plex player is separate.')
                    : t(optimizationDescription(app.packageName, app.system).explanation);
            if (
                action === 'disable' &&
                !window.confirm(
                    `${t(optimizationDescription(app.packageName, app.system).name)}\n${app.packageName}\n\n${warning}\n\n${t('Disable this application?')}`,
                )
            )
                return;
            this.pending = true;
            for (const button of this.container.querySelectorAll('button')) button.disabled = true;
            status.textContent = t('Loading…');
            try {
                await this.request({ packageName: app.packageName, action, user: data.user });
                const updated = await this.request();
                if (!this.disposed) this.render(updated);
            } catch (error) {
                if (!this.disposed) {
                    status.textContent = String(error);
                    refresh.disabled = false;
                    showProtected.disabled = false;
                    this.pending = false;
                    renderApps();
                }
            } finally {
                this.pending = false;
            }
        };
        const renderApps = (): void => {
            list.replaceChildren();
            const shown = data.apps
                .filter((app) => {
                    const info = optimizationDescription(app.packageName, app.system);
                    const matches = `${app.packageName} ${t(info.name)} ${t(info.explanation)}`
                        .toLocaleLowerCase()
                        .includes(this.query.toLocaleLowerCase().trim());
                    return (
                        matches &&
                        (this.category === 'all' ||
                            (this.category === 'focused' &&
                                (app.system !== true ||
                                    app.category !== 'Application' ||
                                    app.disabled ||
                                    app.protection)) ||
                            (this.category === 'system' && app.system === true) ||
                            (this.category === 'user' && app.system === false) ||
                            (this.category === 'disabled' && app.disabled) ||
                            (this.category === 'protected' && app.protection) ||
                            app.category === this.category)
                    );
                })
                .sort(
                    (a, b) =>
                        t(optimizationDescription(a.packageName, a.system).name).localeCompare(
                            t(optimizationDescription(b.packageName, b.system).name),
                        ) || a.packageName.localeCompare(b.packageName),
                );
            this.page = Math.max(0, Math.min(this.page, Math.ceil(shown.length / this.pageSize) - 1));
            const start = this.page * this.pageSize;
            count.textContent = `${shown.length ? start + 1 : 0}–${Math.min(start + this.pageSize, shown.length)} / ${shown.length} · ${t('Total')}: ${data.apps.length}`;
            previous.disabled = this.pending || this.page === 0;
            next.disabled = this.pending || start + this.pageSize >= shown.length;
            focusedNote.textContent =
                this.category === 'focused'
                    ? t(
                          'Showing telemetry, diagnostics, Plex and user apps, plus disabled or protected apps. Advanced shows every package. This view is not a recommendation to disable everything.',
                      )
                    : t('Every action remains manual. System components can provide essential TV functions.');
            for (const app of shown.slice(start, start + this.pageSize)) {
                const info = optimizationDescription(app.packageName, app.system);
                const row = document.createElement('div');
                row.className = 'manager-app';
                const details = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = t(info.name);
                const identifier = document.createElement('small');
                identifier.textContent = app.packageName;
                identifier.dataset['i18nSkip'] = '';
                const explanation = document.createElement('p');
                explanation.textContent = t(info.explanation);
                explanation.className = 'optimization-explanation';
                const meta = document.createElement('small');
                meta.textContent = `${t(app.category)} · ${t(app.disabled ? 'Disabled' : 'Enabled')}${app.protection ? ` · ${t(app.protection)}` : ''}`;
                details.append(name, identifier, meta, explanation);
                const toggle = document.createElement('button');
                toggle.textContent = t(app.disabled ? 'Enable' : 'Disable');
                toggle.disabled = this.pending || (!app.disabled && (!!app.protection || !data.reliable));
                toggle.onclick = () => void change(app, app.disabled ? 'enable' : 'disable');
                const protect = document.createElement('button');
                protect.textContent = t(app.manual ? 'Remove manual protection' : 'Protect');
                protect.disabled = this.pending;
                protect.onclick = () => void change(app, app.manual ? 'unprotect' : 'protect');
                const actions = document.createElement('div');
                actions.className = 'optimization-actions';
                actions.append(toggle, protect);
                row.append(details, actions);
                list.append(row);
            }
            if (!shown.length) list.textContent = t('No matching applications.');
        };
        search.oninput = () => {
            this.query = search.value;
            this.page = 0;
            renderApps();
        };
        filter.onchange = () => {
            this.category = filter.value;
            this.page = 0;
            renderApps();
        };
        toolbar.append(refresh, search, filter);
        const heading = document.createElement('h2');
        heading.textContent = t('Optimization');
        const diagnostic = document.createElement('section');
        diagnostic.className = 'optimization-diagnostics';
        const diagnosticTitle = document.createElement('h3');
        diagnosticTitle.textContent = t('Diagnostics and protections');
        diagnostic.append(diagnosticTitle, user, status);
        const protectedSummary = document.createElement('p');
        const protectedApps = data.apps.filter((app) => app.protection);
        protectedSummary.textContent = `${t('Protected apps')}: ${protectedApps.length}`;
        const showProtected = document.createElement('button');
        showProtected.textContent = t('Show protected apps');
        showProtected.onclick = () => {
            this.query = '';
            search.value = '';
            filter.value = 'protected';
            this.category = 'protected';
            this.page = 0;
            renderApps();
        };
        // Batch actions share one flow: POST, refresh, then report what Android accepted or refused.
        const bulk = async (endpoint: string, body: unknown, done: string): Promise<void> => {
            this.pending = true;
            for (const button of this.container.querySelectorAll('button')) button.disabled = true;
            status.textContent = t('Loading…');
            try {
                const response = await fetch(`/api/manager/${endpoint}?serial=${encodeURIComponent(this.serial)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(t(result.error ?? `HTTP ${response.status}`));
                this.pending = false;
                await this.refresh();
                if (!this.disposed) {
                    const failed = (result.failed as { packageName: string; error: string }[])
                        .map((item) => `${item.packageName}: ${t(item.error)}`)
                        .join('\n');
                    const count = (result.enabled ?? result.disabled).length;
                    window.alert(`${t(done)}: ${count}${failed ? `\n${t('Failed')}:\n${failed}` : ''}`);
                }
            } catch (error) {
                this.pending = false;
                if (!this.disposed) {
                    status.textContent = String(error);
                    for (const button of this.container.querySelectorAll('button')) button.disabled = false;
                    renderApps();
                }
            }
        };
        const restoreAll = document.createElement('button');
        restoreAll.textContent = t('Re-enable apps disabled here');
        restoreAll.onclick = () => {
            if (this.pending || !window.confirm(t('Re-enable every application that Shield Controller disabled?')))
                return;
            void bulk('optimization-restore', { user: data.user }, 'Re-enabled');
        };
        const wizard = document.createElement('details');
        wizard.className = 'optimization-section';
        const wizardTitle = document.createElement('summary');
        wizardTitle.textContent = t('Recommended cleanup');
        const wizardNote = document.createElement('p');
        wizardNote.textContent = t(
            'Telemetry and feedback apps are preselected. Optional items remove a feature you may use: tick them only if you do not need it. Protections still apply to each app, and everything can be re-enabled.',
        );
        wizard.append(wizardTitle, wizardNote);
        const candidates = data.apps.filter((app) => app.recommendation && !app.disabled && !app.protection);
        const boxes: HTMLInputElement[] = [];
        for (const app of candidates.sort(
            (a, b) => Number(b.recommendation === 'recommended') - Number(a.recommendation === 'recommended'),
        )) {
            const info = optimizationDescription(app.packageName, app.system);
            const label = document.createElement('label');
            label.className = 'optimization-choice';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.value = app.packageName;
            box.checked = app.recommendation === 'recommended';
            const text = document.createElement('span');
            text.textContent = `${t(info.name)} (${app.packageName}) · ${t(app.recommendation === 'recommended' ? 'Recommended' : 'Optional')} — ${t(info.explanation)}`;
            label.append(box, text);
            boxes.push(box);
            wizard.append(label);
        }
        const run = document.createElement('button');
        run.textContent = t('Disable selected apps');
        run.disabled = !data.reliable || !candidates.length;
        run.onclick = () => {
            const packages = boxes.filter((box) => box.checked).map((box) => box.value);
            if (
                this.pending ||
                !packages.length ||
                !window.confirm(`${t('Disable these applications?')}\n\n${packages.join('\n')}`)
            )
                return;
            void bulk('optimization-batch', { packages, user: data.user }, 'Disabled apps');
        };
        if (!candidates.length) {
            const empty = document.createElement('p');
            empty.textContent = t(
                'Nothing left to clean up: recommended apps are disabled, protected or not installed.',
            );
            wizard.append(empty);
        }
        wizard.append(run);
        diagnostic.append(protectedSummary, showProtected, restoreAll, protectionNote);
        this.container.append(heading, note, diagnostic, wizard);
        const help = document.createElement('details');
        const helpTitle = document.createElement('summary');
        helpTitle.textContent = t('About these options');
        const labelNote = document.createElement('p');
        labelNote.textContent = t(
            'Names and explanations come from a curated catalog, not from installed APKs. Unknown packages are explicitly marked; their identifiers and all actions remain accessible.',
        );
        help.append(helpTitle, guidance, labelNote);
        this.container.append(help, toolbar, focusedNote, list, pagination);
        // Rendering occurs after loading; controls must be usable on the first page.
        this.pending = false;
        renderApps();
        for (const [label, value] of [
            ['Process CPU snapshot', data.processes],
            ['Memory', data.memory],
            ['Storage', data.storage],
        ]) {
            const section = document.createElement('details');
            const title = document.createElement('summary');
            title.textContent = t(label!);
            const output = document.createElement('pre');
            output.style.whiteSpace = 'pre-wrap';
            output.style.overflowWrap = 'anywhere';
            output.textContent = value!;
            section.append(title, output);
            diagnostic.append(section);
        }
        const history = document.createElement('details');
        const title = document.createElement('summary');
        title.textContent = t('Action history (last 200)');
        history.append(title);
        const explanation = document.createElement('p');
        explanation.textContent = t(
            'History is stored on this server per device and Android user. Pending means the result is unknown: refresh before retrying.',
        );
        history.append(explanation);
        for (const entry of data.history) {
            const row = document.createElement('p');
            row.textContent = `${new Date(entry.at).toLocaleString()} — ${entry.packageName} — ${t(entry.action)} — ${t(entry.result)}`;
            history.append(row);
        }
        if (!data.history.length) {
            const empty = document.createElement('p');
            empty.textContent = t('No actions recorded.');
            history.append(empty);
        }
        this.container.append(history);
    }
}
