import type { AdbClient } from './AdbClient';
import { shArg } from './security/deviceInput';

const PACKAGE = /^[a-zA-Z][\w]*(?:\.[\w]+)+$/;
// Deliberately small catalogue: a name match is never proof of tracking or microphone use.
const CATALOGUE: Record<string, [string, string]> = {
    'com.google.android.katniss': ['voice', 'Google voice search; disabling removes voice search.'],
    'com.google.android.speech.pumpkin': ['voice', 'Offline speech recognition.'],
    'org.droidtv.amazonalexa': ['voice', 'Alexa voice assistant.'],
    'tv.inscape.tvclient.inscapeacr': ['acr', 'Content recognition component.'],
    'tv.samba.ssm.ui': ['acr', 'Content recognition component.'],
    'com.skyworth.aisense': ['acr', 'Content recognition component.'],
    'com.nvidia.stats': ['telemetry', 'NVIDIA usage statistics.'],
    'com.nvidia.feedback': ['telemetry', 'NVIDIA feedback and crash reports.'],
    'com.google.android.feedback': ['telemetry', 'Google feedback and diagnostics.'],
    'com.tcl.logkit': ['telemetry', 'Manufacturer diagnostic logs.'],
    'org.droidtv.usagelogger': ['telemetry', 'Manufacturer usage logs.'],
};
export function microphoneEvidence(dump: string, ops: string) {
    const own = dump.split('\nShared users:')[0] ?? '';
    const uid = /^\s*(?:userId|appId)=(\d+)/m.exec(own)?.[1];
    const block = /requested permissions:([\s\S]*?)(?:\n\s*(?:install|runtime) permissions:|\n\s*User \d+:|$)/.exec(
        own,
    )?.[1];
    const shared = uid === '1000';
    const declared = shared || block === undefined ? null : /android.permission.RECORD_AUDIO\b/.test(block);
    // An allowed mode, rejectTime, or shared UID grant does not prove microphone access.
    const accessed =
        shared || /error|exception/i.test(ops)
            ? null
            : /^\s*RECORD_AUDIO:.*(?:; time=[^;\n]+ ago|\(running\))/m.test(ops)
              ? true
              : /^\s*No operations\.\s*$/m.test(ops)
                ? false
                : null;
    return { sharedSystemUid: shared, declared, accessed };
}
export async function auditPrivacy(adb: Pick<AdbClient, 'shell'>, serial: string, user: number) {
    const read = (cmd: string) => adb.shell(serial, cmd).catch(() => '');
    const installed = (await read(`pm list packages --user ${user}`))
        .split(/\r?\n/)
        .filter((p) => p.startsWith('package:'))
        .map((p) => p.slice(8).trim())
        .filter((p) => PACKAGE.test(p));
    if (!installed.length) throw new Error('Android package list unavailable.');
    const owners = new Set<string>();
    for (const key of ['voice_interaction_service', 'voice_recognition_service', 'assistant']) {
        const value = (await read(`settings --user ${user} get secure ${key}`)).trim().split('/')[0]!;
        if (PACKAGE.test(value)) owners.add(value);
    }
    const candidates = installed.filter((p) => CATALOGUE[p] || owners.has(p));
    const hints = installed.filter(
        (p) =>
            !candidates.includes(p) &&
            /(?:^|\.)(acr|analytics|assistant|alexa|hotword|telemetry|tracker|voice)/i.test(p),
    );
    const all = [...new Set([...candidates, ...hints])];
    const entries = [];
    for (const pkg of all.slice(0, 25)) {
        const [dump, ops] = await Promise.all([
            read(`dumpsys package ${shArg(pkg)}`),
            read(`cmd appops get --user ${user} ${shArg(pkg)} RECORD_AUDIO`),
        ]);
        entries.push({
            packageName: pkg,
            category: CATALOGUE[pkg]?.[0] ?? (owners.has(pkg) ? 'voice' : 'unknown'),
            note: CATALOGUE[pkg]?.[1] ?? 'Name match only; role unverified.',
            nominated: owners.has(pkg),
            ...microphoneEvidence(dump, ops),
        });
    }
    return { user, at: new Date().toISOString(), entries, skipped: Math.max(0, all.length - 25) };
}
