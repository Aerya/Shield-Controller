import { describe, expect, it } from 'vitest';
import { insecureOriginNotice, loopbackEquivalent, statusAfterProbe } from './secureContext';

// Finding 8.10 — WebCodecs is exposed only in a secure context, so on
// http://<lan-ip>:8000 (the documented way to use the Docker image)
// WebCodecsPlayer.isSupported() is false, getPlayers() returns empty, and the
// device card renders no connect link at all. Measured 2026-09-03 with this
// repo's chromium 151: http://127.0.0.1:PORT gives isSecureContext true and
// VideoDecoder function; http://192.168.87.3:PORT gives false and undefined.
// Chromium's --unsafely-treat-insecure-origin-as-secure changed nothing.
describe('insecureOriginNotice', () => {
    const secure = { isSecureContext: true, location: { protocol: 'http:', hostname: '127.0.0.1', port: '8000' } };
    const lan = { isSecureContext: false, location: { protocol: 'http:', hostname: '192.168.87.3', port: '8000' } };

    it('returns null in a secure context, so nothing is shown when streaming works', () => {
        expect(insecureOriginNotice(secure)).toBeNull();
        expect(
            insecureOriginNotice({
                isSecureContext: true,
                location: { protocol: 'https:', hostname: 'ws.example.com', port: '' },
            }),
        ).toBeNull();
    });

    it('explains the decoder limit and points at the LAN-compatible remote panel', () => {
        const notice = insecureOriginNotice(lan);
        expect(notice).toContain('browser video decoder');
        expect(notice).toContain('view / control');
        expect(notice).toContain('continuous video requires a secure browser context');
        expect(notice).not.toContain('localhost');
        expect(notice).not.toContain('settings → local https');
    });
});

// Smoke row 8.19: after a probe the config modal's status line ended in an
// unconditional "Ready", overwriting the notice — so a LAN user read "ready"
// over a connect button that could not stream.
describe('statusAfterProbe', () => {
    const secure = { isSecureContext: true, location: { protocol: 'http:', hostname: '127.0.0.1', port: '8000' } };
    const lan = { isSecureContext: false, location: { protocol: 'http:', hostname: '192.168.87.3', port: '8000' } };

    it('keeps the notice, as an error, when no player registered on an insecure origin', () => {
        expect(statusAfterProbe(false, lan)).toEqual({ text: insecureOriginNotice(lan), kind: 'error' });
    });

    it('reads Ready whenever a player is registered, or the origin is secure', () => {
        expect(statusAfterProbe(true, secure)).toEqual({ text: 'Ready' });
        expect(statusAfterProbe(true, lan)).toEqual({ text: 'Ready' });
        expect(statusAfterProbe(false, secure)).toEqual({ text: 'Ready' });
    });
});

describe('loopbackEquivalent', () => {
    it('keeps the port so the hint is copy-pasteable', () => {
        expect(loopbackEquivalent({ protocol: 'http:', hostname: '192.168.87.3', port: '8000' })).toBe(
            'http://localhost:8000',
        );
    });

    it('omits an empty port rather than emitting a trailing colon', () => {
        expect(loopbackEquivalent({ protocol: 'http:', hostname: '10.0.0.5', port: '' })).toBe('http://localhost');
    });
});
