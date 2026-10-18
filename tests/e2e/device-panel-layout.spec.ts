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
