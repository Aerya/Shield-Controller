// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemotePreview } from '../RemotePreview';

class Socket {
    static OPEN = 1;
    static last: Socket;
    readyState = 1;
    binaryType = '';
    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    send = vi.fn();
    close = vi.fn();
    constructor(public url: URL) {
        Socket.last = this;
    }
}
beforeEach(() => {
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, blob: async () => new Blob(['png']) })),
    );
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});
it('works without VideoDecoder, sends Unicode clipboard packets and clears the text immediately', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const preview = new RemotePreview(host, 'device', true);
    expect(Socket.last.url.searchParams.get('audio')).toBe('false');
    expect(host.querySelector<HTMLButtonElement>('.remote-pad button')!.disabled).toBe(true);
    Socket.last.onmessage!({ data: Uint8Array.from([4]).buffer });
    const text = host.querySelector('textarea')!;
    text.value = 'https://example.test/?u=é&p=a%20b';
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Paste on Shield')!.click();
    const packet = Socket.last.send.mock.calls[0]![0] as Uint8Array;
    expect(packet[0]).toBe(2);
    expect(packet[1]).toBe(9);
    expect(packet[10]).toBe(1);
    expect(new TextDecoder().decode(packet.subarray(15))).toBe('https://example.test/?u=é&p=a%20b');
    expect(text.value).toBe('');
    preview.dispose();
    expect(Socket.last.close).toHaveBeenCalledOnce();
});
it('downloads the displayed image and stops polling when disposed', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const preview = new RemotePreview(host, 'device', false);
    await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:preview'));
    host.querySelector('img')!.dispatchEvent(new Event('load'));
    host.querySelector('button')!.click();
    expect(host.querySelector('a')!.hidden).toBe(false);
    expect(host.querySelector('a')!.download).toMatch(/\.png$/);
    preview.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
});
