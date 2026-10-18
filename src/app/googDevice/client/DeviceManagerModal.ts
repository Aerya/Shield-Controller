import '../../../style/device-manager.css';
import { Modal } from '../../ui/Modal';

interface AppRow {
    packageName: string;
    versionCode: string;
    path: string;
    system: boolean;
    disabled: boolean;
}

export class DeviceManagerModal extends Modal {
    private serial: string;
    private apps: AppRow[] = [];
    private pending = false;
    private disposed = false;
    private xhr: XMLHttpRequest | undefined;
    declare private status: HTMLElement;
    declare private content: HTMLElement;

    constructor(serial: string, label: string, tab: 'info' | 'apps') {
        super({ title: `Shield Controller — ${label}` });
        this.serial = serial;
        this.frameEl.classList.add('device-manager');
        const tabs = document.createElement('div');
        tabs.className = 'manager-toolbar';
        for (const [name, text] of [
            ['info', 'Device information'],
            ['apps', 'Applications'],
        ] as const) {
            const button = document.createElement('button');
            button.textContent = text;
            button.addEventListener('click', () => {
                if (this.pending) return;
                void this.load(name);
            });
            tabs.append(button);
        }
        this.bodyEl.prepend(tabs);
        void this.load(tab);
    }

    protected override buildBody(container: HTMLElement): void {
        this.status = document.createElement('p');
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        this.content = document.createElement('div');
        container.append(this.status, this.content);
    }

    override close(result?: unknown): void {
        if (
            this.pending &&
            !window.confirm(
                'An operation is running. Close this panel? An installation already sent to Android may continue.',
            )
        )
            return;
        this.disposed = true;
        this.xhr?.abort();
        super.close(result);
    }

    private endpoint(action: string): string {
        return `/api/manager/${action}?serial=${encodeURIComponent(this.serial)}`;
    }

    private async request(action: string, init?: RequestInit): Promise<any> {
        const response = await fetch(this.endpoint(action), init);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data;
    }

    private async load(tab: 'info' | 'apps'): Promise<void> {
        this.pending = true;
        this.status.textContent = 'Loading…';
        this.content.replaceChildren();
        try {
            if (tab === 'info') this.renderInfo(await this.request('info'));
            else {
                this.apps = (await this.request('apps')).apps;
                this.renderApps();
            }
            this.status.textContent = '';
        } catch (error) {
            this.showError(error);
        } finally {
            this.pending = false;
        }
    }

    private showError(error: unknown): void {
        if (!this.disposed) this.status.textContent = error instanceof Error ? error.message : String(error);
    }

    private renderInfo(data: Record<string, any>): void {
        if (this.disposed) return;
        const props = data['properties'] ?? {};
        const rows = [
            ['Manufacturer', props['ro.product.manufacturer']],
            ['Model', props['ro.product.model']],
            ['Product', props['ro.product.name']],
            ['Android', props['ro.build.version.release']],
            ['SDK', props['ro.build.version.sdk']],
            ['Security patch', props['ro.build.version.security_patch']],
            ['Build', props['ro.build.display.id']],
            ['Hardware', props['ro.hardware']],
            ['CPU architecture', props['ro.product.cpu.abilist'] || props['ro.product.cpu.abi']],
            ['Serial', props['ro.serialno'] || data['serial']],
        ];
        const memory = String(data['memory']).match(/MemTotal:\s+(\d+)/);
        const available = String(data['memory']).match(/MemAvailable:\s+(\d+)/);
        const seconds = Number.parseFloat(String(data['uptime']));
        rows.push(['RAM total', memory ? `${(Number(memory[1]) / 1048576).toFixed(2)} GiB` : 'Unavailable']);
        rows.push(['RAM available', available ? `${(Number(available[1]) / 1048576).toFixed(2)} GiB` : 'Unavailable']);
        rows.push([
            'Uptime',
            Number.isFinite(seconds)
                ? `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m`
                : 'Unavailable',
        ]);
        const table = document.createElement('dl');
        table.className = 'manager-info';
        for (const [key, value] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = key ?? '';
            const dd = document.createElement('dd');
            dd.textContent = value || 'Unavailable';
            table.append(dt, dd);
        }
        this.content.append(table);
        for (const [key, title] of [
            ['storage', 'Storage (KiB)'],
            ['network', 'Network addresses'],
            ['display', 'Display'],
            ['cpu', 'CPU details'],
        ]) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = title!;
            const pre = document.createElement('pre');
            pre.textContent = data[key!] || 'Unavailable';
            details.append(summary, pre);
            this.content.append(details);
        }
        const refresh = document.createElement('button');
        refresh.textContent = 'Refresh';
        refresh.onclick = () => {
            if (!this.pending) void this.load('info');
        };
        this.content.append(refresh);
    }

    private renderApps(): void {
        if (this.disposed) return;
        this.content.replaceChildren();
        const drop = document.createElement('div');
        drop.className = 'manager-apk-drop';
        const help = document.createElement('p');
        help.textContent =
            'Drop APK files here, or choose files. Single APKs only, up to 512 MiB each. Existing apps are updated with their data preserved when Android permits it.';
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.apk';
        input.multiple = true;
        input.setAttribute('aria-label', 'Choose APK files');
        input.onchange = () => {
            void this.installFiles(Array.from(input.files ?? []));
            input.value = '';
        };
        drop.ondragover = (event) => {
            event.preventDefault();
            drop.classList.add('drag-over');
        };
        drop.ondragleave = () => drop.classList.remove('drag-over');
        drop.ondrop = (event) => {
            event.preventDefault();
            drop.classList.remove('drag-over');
            void this.installFiles(Array.from(event.dataTransfer?.files ?? []));
        };
        drop.append(help, input);
        const tools = document.createElement('div');
        tools.className = 'manager-toolbar';
        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search package name…';
        search.setAttribute('aria-label', 'Search applications');
        const filter = document.createElement('select');
        filter.setAttribute('aria-label', 'Application type');
        for (const [value, label] of [
            ['user', 'User apps'],
            ['all', 'All apps'],
            ['system', 'System apps'],
            ['disabled', 'Disabled apps'],
        ]) {
            const option = document.createElement('option');
            option.value = value!;
            option.textContent = label!;
            filter.append(option);
        }
        const refresh = document.createElement('button');
        refresh.textContent = 'Refresh';
        refresh.onclick = () => {
            if (!this.pending) void this.load('apps');
        };
        const count = document.createElement('span');
        tools.append(search, filter, refresh, count);
        const list = document.createElement('div');
        list.className = 'manager-app-list';
        const render = () => {
            list.replaceChildren();
            const shown = this.apps.filter(
                (app) =>
                    app.packageName.toLowerCase().includes(search.value.toLowerCase()) &&
                    (filter.value === 'all' ||
                        (filter.value === 'user' && !app.system) ||
                        (filter.value === 'system' && app.system) ||
                        (filter.value === 'disabled' && app.disabled)),
            );
            count.textContent = `${shown.length} / ${this.apps.length} apps`;
            if (!shown.length) {
                const empty = document.createElement('p');
                empty.textContent = 'No matching applications.';
                list.append(empty);
            }
            for (const app of shown) {
                const row = document.createElement('div');
                row.className = 'manager-app';
                const text = document.createElement('div');
                const name = document.createElement('strong');
                name.textContent = app.packageName;
                const meta = document.createElement('small');
                meta.textContent = `${app.system ? 'System' : 'User'}${app.disabled ? ' · Disabled' : ''} · Version code ${app.versionCode || 'unknown'}`;
                const path = document.createElement('small');
                path.textContent = app.path;
                text.append(name, meta, path);
                const remove = document.createElement('button');
                remove.textContent = 'Uninstall';
                remove.onclick = async () => {
                    if (this.pending) return;
                    const warning = app.system
                        ? '\n\nThis is a system app. Removing it for user 0 can break TV functions. Its system image remains on the device.'
                        : '';
                    if (!window.confirm(`Uninstall ${app.packageName} for user 0?${warning}`)) return;
                    this.pending = true;
                    remove.disabled = true;
                    this.status.textContent = `Uninstalling ${app.packageName}…`;
                    try {
                        await this.request('uninstall', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ packageName: app.packageName }),
                        });
                        this.apps = this.apps.filter((item) => item.packageName !== app.packageName);
                        render();
                        this.status.textContent = `${app.packageName} uninstalled.`;
                    } catch (error) {
                        this.showError(error);
                    } finally {
                        this.pending = false;
                        remove.disabled = false;
                    }
                };
                row.append(text, remove);
                list.append(row);
            }
        };
        search.oninput = render;
        filter.onchange = render;
        this.content.append(drop, tools, list);
        render();
    }

    private async installFiles(files: File[]): Promise<void> {
        if (this.pending || !files.length) return;
        if (
            files.some(
                (file) => !file.name.toLowerCase().endsWith('.apk') || !file.size || file.size > 512 * 1024 * 1024,
            )
        ) {
            this.status.textContent =
                'Choose non-empty .apk files, at most 512 MiB each. Split APK bundles (.apks/.xapk) are not supported.';
            return;
        }
        this.pending = true;
        let completed = 0;
        try {
            for (const file of files) {
                if (this.disposed) break;
                await new Promise<void>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    this.xhr = xhr;
                    xhr.open('POST', this.endpoint('install'));
                    xhr.timeout = 600_000;
                    xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
                    xhr.upload.onprogress = (event) => {
                        this.status.textContent = `Uploading ${file.name}: ${event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : '?'}%`;
                    };
                    xhr.upload.onload = () => {
                        this.status.textContent = `Installing ${file.name} on the device…`;
                    };
                    xhr.onload = () => {
                        let data: { error?: string } = {};
                        try {
                            data = JSON.parse(xhr.responseText);
                        } catch {
                            /* HTTP status remains useful. */
                        }
                        if (xhr.status >= 200 && xhr.status < 300) resolve();
                        else reject(new Error(data.error || `HTTP ${xhr.status}`));
                    };
                    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
                    xhr.ontimeout = () =>
                        reject(new Error('Installation timed out. Refresh the app list to check its state.'));
                    xhr.onabort = () => reject(new Error('Upload canceled.'));
                    xhr.send(file);
                });
                completed++;
            }
            if (!this.disposed) {
                this.apps = (await this.request('apps')).apps;
                this.renderApps();
                this.status.textContent = `${completed} APK(s) installed successfully.`;
            }
        } catch (error) {
            this.showError(error);
        } finally {
            this.pending = false;
            this.xhr = undefined;
        }
    }
}
