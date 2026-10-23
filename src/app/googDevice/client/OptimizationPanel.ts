import { t } from '../../client/Language';

interface App {
    packageName: string;
    disabled: boolean;
    category: string;
    protection: string | null;
    manual: boolean;
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
    private category = 'all';
    constructor(
        private readonly container: HTMLElement,
        private readonly serial: string,
    ) {
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
            'all',
            'disabled',
            'protected',
            'Telemetry / feedback',
            'NVIDIA diagnostics',
            'Local Plex server',
            'Plex player',
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = t(value);
            filter.append(option);
        }
        filter.value = this.category;
        const list = document.createElement('div');
        const change = async (app: App, action: string): Promise<void> => {
            if (this.pending) return;
            const warning =
                app.category === 'Local Plex server'
                    ? t('This stops libraries and streams hosted by this Shield. The Plex player is separate.')
                    : t('This app and its background services will stop until re-enabled.');
            if (
                action === 'disable' &&
                !window.confirm(`${app.packageName}\n\n${warning}\n\n${t('Disable this application?')}`)
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
                    renderApps();
                }
            } finally {
                this.pending = false;
            }
        };
        const renderApps = (): void => {
            list.replaceChildren();
            const shown = data.apps.filter(
                (app) =>
                    app.packageName.toLowerCase().includes(this.query.toLowerCase()) &&
                    (this.category === 'all' ||
                        (this.category === 'disabled' && app.disabled) ||
                        (this.category === 'protected' && app.protection) ||
                        app.category === this.category),
            );
            for (const app of shown) {
                const row = document.createElement('div');
                row.className = 'manager-app';
                const details = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = app.packageName;
                const meta = document.createElement('small');
                meta.textContent = `${t(app.category)} · ${t(app.disabled ? 'Disabled' : 'Enabled')}${app.protection ? ` · ${t(app.protection)}` : ''}`;
                details.append(name, meta);
                const toggle = document.createElement('button');
                toggle.textContent = t(app.disabled ? 'Enable' : 'Disable');
                toggle.disabled = !app.disabled && (!!app.protection || !data.reliable);
                toggle.onclick = () => void change(app, app.disabled ? 'enable' : 'disable');
                const protect = document.createElement('button');
                protect.textContent = t(app.manual ? 'Remove manual protection' : 'Protect');
                protect.onclick = () => void change(app, app.manual ? 'unprotect' : 'protect');
                row.append(details, toggle, protect);
                list.append(row);
            }
            if (!shown.length) list.textContent = t('No matching applications.');
        };
        search.oninput = () => {
            this.query = search.value;
            renderApps();
        };
        filter.onchange = () => {
            this.category = filter.value;
            renderApps();
        };
        toolbar.append(refresh, search, filter);
        this.container.append(note, guidance, protectionNote, user, toolbar, status, list);
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
            this.container.append(section);
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
