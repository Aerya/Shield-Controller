import { createWriteStream } from 'fs';
import { mkdtemp, open, rm } from 'fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { AdbClient, parseGetProp } from '../AdbClient';
import { requireOperator } from '../auth/requireOperator';
import { Config } from '../Config';
import { isValidSerial, shArg } from '../security/deviceInput';
import { BodyTooLargeError, InvalidJsonError, readJsonBodyStrict } from './utils';

export const MAX_APK_BYTES = 512 * 1024 * 1024;
export const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;

export interface ManagedApp {
    packageName: string;
    versionCode: string;
    path: string;
    system: boolean;
    disabled: boolean;
}

export function parseApplications(list: string, system: string, disabled: string): ManagedApp[] {
    const names = (text: string) => new Set(text.split(/\r?\n/).map((line) => line.trim().replace(/^package:/, '')));
    const systems = names(system);
    const disabledNames = names(disabled);
    return list
        .split(/\r?\n/)
        .flatMap((line) => {
            const match = /^package:(.+)=([\w.]+)(?:\s+versionCode:(\S+))?\s*$/.exec(line.trim());
            if (!match || !PACKAGE_NAME.test(match[2]!)) return [];
            return [
                {
                    packageName: match[2]!,
                    path: match[1]!,
                    versionCode: match[3] ?? '',
                    system: systems.has(match[2]!),
                    disabled: disabledNames.has(match[2]!),
                },
            ];
        })
        .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

function reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

export class DeviceManagerApi {
    private readonly busy = new Set<string>();
    constructor(private readonly adb = new AdbClient(Config.getInstance().adbPath)) {}

    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/manager/')) return false;
        if (!requireOperator(req, res)) return true;
        const serial = url.searchParams.get('serial');
        if (!isValidSerial(serial)) {
            reply(res, 400, { error: 'Invalid device identifier.' });
            return true;
        }
        try {
            const device = (await this.adb.devices()).find((item) => item.serial === serial);
            if (device?.state !== 'device') {
                reply(res, 409, { error: 'Device disconnected or awaiting authorization on the TV.' });
                return true;
            }
            if (req.method === 'GET' && url.pathname === '/api/manager/info') {
                const commands = {
                    properties: 'getprop',
                    memory: 'cat /proc/meminfo',
                    storage: 'df -k /data /sdcard',
                    uptime: 'cat /proc/uptime',
                    network: 'ip -o addr show',
                    display: 'wm size; wm density',
                    cpu: 'cat /proc/cpuinfo',
                };
                const entries = await Promise.all(
                    Object.entries(commands).map(async ([key, command]) => {
                        try {
                            return [key, await this.adb.shell(serial, command)] as const;
                        } catch {
                            return [key, 'Unavailable on this device'] as const;
                        }
                    }),
                );
                const data = Object.fromEntries(entries);
                reply(res, 200, { ...data, properties: parseGetProp(data['properties'] ?? ''), serial });
            } else if (req.method === 'GET' && url.pathname === '/api/manager/apps') {
                const [list, system, disabled] = await Promise.all([
                    this.adb.shell(serial, 'pm list packages -f --show-versioncode'),
                    this.adb.shell(serial, 'pm list packages -s'),
                    this.adb.shell(serial, 'pm list packages -d'),
                ]);
                reply(res, 200, { apps: parseApplications(list, system, disabled) });
            } else if (req.method === 'POST' && url.pathname === '/api/manager/uninstall') {
                const body = await readJsonBodyStrict(req);
                const pkg = body['packageName'];
                if (typeof pkg !== 'string' || !PACKAGE_NAME.test(pkg)) {
                    reply(res, 400, { error: 'Invalid application package name.' });
                    return true;
                }
                const output = await this.adb.shell(serial, `pm uninstall --user 0 ${shArg(pkg)}`, 60_000);
                reply(res, /\bSuccess\b/.test(output) ? 200 : 422, {
                    success: /\bSuccess\b/.test(output),
                    message: output,
                    ...(!/\bSuccess\b/.test(output) ? { error: output || 'Uninstall refused by Android.' } : {}),
                });
            } else if (req.method === 'POST' && url.pathname === '/api/manager/install') {
                if (this.busy.has(serial)) {
                    reply(res, 409, { error: 'An APK installation is already running on this device.' });
                    return true;
                }
                this.busy.add(serial);
                try {
                    await this.install(req, res, serial);
                } finally {
                    this.busy.delete(serial);
                }
            } else {
                reply(res, 404, { error: 'Unknown device management endpoint.' });
            }
        } catch (error) {
            const status = error instanceof BodyTooLargeError ? 413 : error instanceof InvalidJsonError ? 400 : 502;
            reply(res, status, { error: error instanceof Error ? error.message : 'Device operation failed.' });
        }
        return true;
    }

    private async install(req: IncomingMessage, res: ServerResponse, serial: string): Promise<void> {
        if (req.headers['content-type']?.split(';')[0] !== 'application/vnd.android.package-archive') {
            reply(res, 415, { error: 'Select a single .apk file (split APK bundles are not supported).' });
            return;
        }
        if (Number(req.headers['content-length']) > MAX_APK_BYTES) {
            reply(res, 413, { error: 'APK exceeds the 512 MiB limit.' });
            return;
        }
        const dir = await mkdtemp(join(tmpdir(), 'shield-apk-'));
        const apk = join(dir, 'upload.apk');
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 300_000);
        try {
            let bytes = 0;
            // Stream to disk: APKs never accumulate in server memory. Drain excess
            // input so a size error can still receive an HTTP response.
            const cap = new Transform({
                transform(chunk: Buffer, _encoding, done) {
                    bytes += chunk.length;
                    done(null, bytes <= MAX_APK_BYTES ? chunk : undefined);
                },
            });
            await pipeline(req, cap, createWriteStream(apk, { mode: 0o600 }), { signal: abort.signal });
            if (bytes > MAX_APK_BYTES) throw new BodyTooLargeError(MAX_APK_BYTES);
            const file = await open(apk, 'r');
            try {
                const magic = Buffer.alloc(4);
                await file.read(magic, 0, 4, 0);
                if (!magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
                    reply(res, 400, { error: 'Invalid APK: expected an Android ZIP package.' });
                    return;
                }
            } finally {
                await file.close();
            }
            const output = await this.adb.installApk(serial, apk);
            const success = /\bSuccess\b/.test(output);
            reply(
                res,
                success ? 200 : 422,
                success ? { success, message: output } : { error: output || 'Android refused the APK.' },
            );
        } finally {
            clearTimeout(timer);
            await rm(dir, { recursive: true, force: true });
        }
    }
}
