import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const css = readFileSync('src/style/devicelist.css', 'utf8');

for (const width of [1578, 1100, 390]) {
    test(`device tools remain visible inside the real tracker grid at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        // Keep the tracker wrapper: mounting a workspace directly under .device-list
        // misses the auto-fill grid that previously collapsed the panel to zero pixels.
        await page.setContent(`<!doctype html><html><head><style>body{margin:0}</style></head><body class="list">
            <div id="devices"><div class="device-list"><div id="tracker">
                <div class="tracker-name">Connected Devices</div>
                <div class="device-workspace">
                    <div class="device active"><p>SHIELD Android TV</p><button>DNS / IPv4 / IPv6</button></div>
                    <section class="device-detail-panel"><dialog open class="modal device-panel-dialog">
                        <div class="modal-frame device-manager"><div class="modal-body">Device information and DNS tools</div></div>
                    </dialog></section>
                </div>
            </div></div></div></body></html>`);
        await page.addStyleTag({ content: css });
        const tracker = await page.locator('#tracker').boundingBox();
        const workspace = await page.locator('.device-workspace').boundingBox();
        const card = await page.locator('.device').boundingBox();
        const panel = await page.locator('.device-detail-panel').boundingBox();
        const content = await page.locator('.modal-body').boundingBox();
        expect(workspace!.width).toBeCloseTo(tracker!.width, 0);
        expect(content!.width).toBeGreaterThan(280);
        if (width > 850) {
            expect(panel!.x).toBeGreaterThanOrEqual(card!.x + card!.width);
            expect(panel!.width).toBeGreaterThan(tracker!.width * 0.45);
        } else {
            expect(panel!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
            expect(panel!.width).toBeCloseTo(workspace!.width, 0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

// Execute the actual panel implementation, with only translation and ADB HTTP mocked.
for (const width of [1100, 390]) {
    test(`optimization protects playback and performs explicit reversible actions at ${width}px`, async ({ page }) => {
        const { transformSync } = await import('@swc/core');
        const catalog = readFileSync('src/app/googDevice/client/OptimizationCatalog.ts', 'utf8').replace(
            'export function',
            'function',
        );
        const source =
            catalog +
            readFileSync('src/app/googDevice/client/OptimizationPanel.ts', 'utf8')
                .replace("import { optimizationDescription } from './OptimizationCatalog';", '')
                .replace("import { t } from '../../client/Language';", 'const t = (value: string): string => value;')
                .replace('export class OptimizationPanel', 'class OptimizationPanel');
        const code = transformSync(source, { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } }).code;
        let disabled = false;
        const actions: string[] = [];
        await page.route('http://shield.test/api/manager/optimization?serial=tv', async (route) => {
            if (route.request().method() === 'POST') {
                const body = route.request().postDataJSON();
                actions.push(body.action);
                disabled = body.action === 'disable';
                await route.fulfill({ json: { success: true } });
            } else
                await route.fulfill({
                    json: {
                        user: 0,
                        reliable: true,
                        processes: 'CPU sample',
                        memory: 'Memory sample',
                        storage: '/data',
                        history: [],
                        apps: [
                            {
                                packageName: 'com.home.launcher',
                                category: 'Application',
                                disabled: false,
                                protection: 'Active launcher',
                                manual: false,
                            },
                            {
                                packageName: 'com.nvidia.stats',
                                category: 'Telemetry / feedback',
                                disabled,
                                protection: null,
                                manual: false,
                            },
                        ],
                    },
                });
        });
        await page.route('http://shield.test/', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<html><body><div class="device-manager" id="panel"></div></body></html>',
            }),
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('http://shield.test/');
        await page.addStyleTag({ content: readFileSync('src/style/device-manager.css', 'utf8') });
        await page.addScriptTag({ content: `${code}\nnew OptimizationPanel(document.getElementById("panel"), "tv");` });
        const launcher = page.locator('.manager-app').filter({ hasText: 'com.home.launcher' });
        const telemetry = page.locator('.manager-app').filter({ hasText: 'com.nvidia.stats' });
        await expect(launcher.getByRole('button', { name: 'Disable', exact: true })).toBeDisabled();
        expect(actions).toEqual([]);
        page.once('dialog', (dialog) => dialog.dismiss());
        await telemetry.getByRole('button', { name: 'Disable', exact: true }).click();
        expect(actions).toEqual([]);
        page.once('dialog', (dialog) => dialog.accept());
        await telemetry.getByRole('button', { name: 'Disable', exact: true }).click();
        await expect(telemetry.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
        await telemetry.getByRole('button', { name: 'Enable', exact: true }).click();
        await expect(telemetry.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
        expect(actions).toEqual(['disable', 'enable']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const width of [1100, 390]) {
    test(`optimization inventory stays readable and complete at ${width}px`, async ({ page }) => {
        const { transformSync } = await import('@swc/core');
        const catalog = readFileSync('src/app/googDevice/client/OptimizationCatalog.ts', 'utf8').replace(
            'export function',
            'function',
        );
        const translations = readFileSync('src/common/locales/fr.json', 'utf8');
        const source =
            catalog +
            readFileSync('src/app/googDevice/client/OptimizationPanel.ts', 'utf8')
                .replace("import { optimizationDescription } from './OptimizationCatalog';", '')
                .replace(
                    "import { t } from '../../client/Language';",
                    `const translations: Record<string, string> = ${translations}; const t = (value: string): string => translations[value] ?? value;`,
                )
                .replace('export class OptimizationPanel', 'class OptimizationPanel');
        const code = transformSync(source, { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } }).code;
        const known = [
            ['com.nvidia.stats', 'Telemetry / feedback', null],
            ['com.nvidia.feedback', 'Telemetry / feedback', null],
            ['com.nvidia.diagtools', 'NVIDIA diagnostics', null],
            ['com.plexapp.mediaserver.smb', 'Local Plex server', null],
            ['com.plexapp.android', 'Plex player', 'Media session'],
            ['com.google.android.tvlauncher', 'Application', 'Active launcher'],
        ].map(([packageName, category, protection]) => ({
            packageName,
            category,
            protection,
            system: true,
            disabled: false,
            manual: false,
        }));
        const extra = Array.from({ length: 30 }, (_, i) => ({
            packageName: `com.system.package${i}`,
            category: 'Application',
            protection: null,
            system: true,
            disabled: false,
            manual: false,
        }));
        let posts = 0;
        await page.route('http://shield.test/api/manager/optimization?serial=tv', async (route) => {
            if (route.request().method() !== 'GET') posts++;
            await route.fulfill({
                json: {
                    user: 0,
                    reliable: true,
                    apps: [...known, ...extra],
                    processes: 'CPU sample',
                    memory: 'MemTotal: 3000000 kB',
                    storage: '/data',
                    history: [],
                },
            });
        });
        await page.route('http://shield.test/', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<html><head><style>body{margin:0;background:#202124;color:#eee;font:15px system-ui}</style></head><body><div class="device-manager" id="panel"></div></body></html>',
            }),
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('http://shield.test/');
        await page.addStyleTag({ content: readFileSync('src/style/device-manager.css', 'utf8') });
        await page.addScriptTag({ content: `${code}\nnew OptimizationPanel(document.getElementById("panel"), "tv");` });
        await expect(page.locator('.manager-app')).toHaveCount(6);
        await expect(page.getByText('Statistiques d’utilisation NVIDIA', { exact: true })).toBeVisible();
        const diagnostic = await page.locator('.optimization-diagnostics').boundingBox();
        const list = await page.locator('.optimization-list').boundingBox();
        expect(diagnostic!.y).toBeLessThan(list!.y);
        const firstRow = page.locator('.manager-app').first();
        const actions = await firstRow.locator('.optimization-actions').boundingBox();
        const details = await firstRow.locator(':scope > div').first().boundingBox();
        if (width > 640) expect(actions!.x).toBeGreaterThan(details!.x + details!.width);
        else expect(actions!.y).toBeGreaterThan(details!.y + details!.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (test.info().project.name === 'chromium')
            await page.screenshot({ path: `../../outputs/optimisation-${width}.png`, fullPage: true });
        await page.getByRole('combobox').selectOption('all');
        await expect(page.locator('.manager-app')).toHaveCount(12);
        const seen = new Set<string>();
        for (let currentPage = 0; currentPage < 4; currentPage++) {
            for (const pkg of await page.locator('.manager-app [data-i18n-skip]').allTextContents()) seen.add(pkg);
            if (await page.getByRole('button', { name: 'Suivant', exact: true }).isDisabled()) break;
            await page.getByRole('button', { name: 'Suivant', exact: true }).click();
        }
        expect(seen.size).toBe(36);
        await page.getByRole('searchbox').fill('statistiques');
        await expect(page.locator('.manager-app')).toHaveCount(1);
        await expect(page.locator('.manager-app')).toContainText('com.nvidia.stats');
        expect(posts).toBe(0);
    });
}
