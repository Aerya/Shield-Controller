import { ChannelId } from '../../../common/ChannelId';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import type { ControlMessage } from '../../controlMessage/ControlMessage';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { TextControlMessage } from '../../controlMessage/TextControlMessage';
import { DeviceMessageFramer } from '../DeviceMessageFramer';

/** LAN HTTP preview and scrcpy control, independent of the browser video decoder. */
export class RemotePreview {
    private stopped = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private abort = new AbortController();
    private current: Blob | undefined;
    private imageUrl: string | undefined;
    private captureUrl: string | undefined;
    private ws: WebSocket | undefined;
    private ready = false;
    private sequence = 0n;
    private readonly image = document.createElement('img');
    private readonly status = document.createElement('p');
    private readonly controls: HTMLButtonElement[] = [];
    private readonly text = document.createElement('textarea');

    constructor(
        private readonly container: HTMLElement,
        private readonly serial: string,
        control: boolean,
    ) {
        container.classList.add('remote-preview');
        this.status.setAttribute('role', 'status');
        this.image.alt = 'Shield preview';
        this.image.style.cssText =
            'display:block;max-width:100%;height:auto;min-height:80px;margin:12px auto;background:#111';
        const caption = document.createElement('p');
        caption.textContent = 'LAN preview: updated images, no audio. Protected video may appear black.';
        const download = document.createElement('a');
        download.hidden = true;
        download.textContent = 'Download PNG';
        const capture = this.button('Capture displayed image', () => {
            if (!this.current) return;
            if (this.captureUrl) URL.revokeObjectURL(this.captureUrl);
            this.captureUrl = URL.createObjectURL(this.current);
            download.href = this.captureUrl;
            download.download = `shield-${Date.now()}.png`;
            download.hidden = false;
            this.status.textContent = 'Screenshot ready.';
        });
        container.append(caption, this.status, this.image, capture, download);
        if (control) this.connectControls();
        void this.refresh();
    }
    dispose(): void {
        this.stopped = true;
        clearTimeout(this.timer);
        this.abort.abort();
        this.ws?.close();
        this.text.value = '';
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        if (this.captureUrl) URL.revokeObjectURL(this.captureUrl);
    }
    private button(label: string, action: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', action);
        return button;
    }
    private async refresh(): Promise<void> {
        if (this.stopped) return;
        try {
            const response = await fetch(`/api/manager/screenshot?serial=${encodeURIComponent(this.serial)}`, {
                signal: this.abort.signal,
            });
            if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
            const blob = await response.blob();
            if (this.stopped) return;
            const previous = this.imageUrl;

            this.imageUrl = URL.createObjectURL(blob);
            this.image.onload = () => {
                this.current = blob;
                if (previous) URL.revokeObjectURL(previous);
            };
            this.image.src = this.imageUrl;
        } catch (error) {
            if (!this.stopped) this.status.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            if (!this.stopped)
                this.timer = setTimeout(() => {
                    void this.refresh();
                }, 1500);
        }
    }
    private send(message: ControlMessage): void {
        if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
        const payload = message.toUint8Array();
        const packet = new Uint8Array(payload.length + 1);
        packet[0] = ChannelId.CONTROL;
        packet.set(payload, 1);
        this.ws.send(packet);
    }
    private key(code: number): void {
        this.send(new KeyCodeControlMessage(0, code, 0, 0));
        this.send(new KeyCodeControlMessage(1, code, 0, 0));
    }
    private connectControls(): void {
        const pad = document.createElement('div');
        pad.className = 'remote-pad';
        for (const [label, code] of [
            ['Home', 3],
            ['↑', 19],
            ['Back', 4],
            ['←', 21],
            ['OK', 23],
            ['→', 22],
            ['Volume −', 25],
            ['↓', 20],
            ['Volume +', 24],
        ] as const) {
            const button = this.button(label, () => this.key(code));
            button.disabled = true;
            this.controls.push(button);
            pad.append(button);
        }
        this.text.placeholder = 'Paste text here, then select the field on the TV and send.';
        this.text.setAttribute('aria-label', 'Text to send to the Shield');
        this.text.maxLength = 16384;
        this.text.autocomplete = 'off';
        this.text.spellcheck = false;
        const send = this.button('Paste on Shield', () => {
            if (!this.text.value || !this.ready) return;
            this.send(CommandControlMessage.createSetClipboardCommand(this.text.value, true, ++this.sequence));
            this.text.value = '';
            this.status.textContent = 'Text sent. Check the selected field on the TV; some applications block pasting.';
        });
        send.disabled = true;
        this.controls.push(send);
        const type = this.button('Type text directly', () => {
            if (!this.ready || !this.text.value) return;
            if (new TextEncoder().encode(this.text.value).length > 300) {
                this.status.textContent = 'Direct typing is limited to 300 bytes. Use Paste on Shield for longer text.';
                return;
            }
            this.send(new TextControlMessage(this.text.value));
            this.text.value = '';
            this.status.textContent = 'Text sent. Check the selected field on the TV; some applications block pasting.';
        });
        type.disabled = true;
        this.controls.push(type);
        const read = this.button('Read Shield clipboard', () =>
            this.send(CommandControlMessage.createGetClipboardCommand()),
        );
        read.disabled = true;
        this.controls.push(read);
        const clear = this.button('Clear text', () => {
            this.text.value = '';
        });
        const note = document.createElement('p');
        note.textContent =
            'Shield Controller does not store this text. Select the target field on the TV first. Use Ctrl+V here; no browser clipboard permission is needed. Paste uses the Android clipboard.';
        this.container.append(pad, note, this.text, send, type, read, clear);
        const framer = new DeviceMessageFramer((message) => {
            if (message[0] === 0 && message.length >= 5)
                this.text.value = new TextDecoder().decode(message.subarray(5));
        });
        const url = new URL(location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.hash = '';
        url.search = '';
        for (const [key, value] of Object.entries({
            action: 'stream',
            udid: this.serial,
            audio: 'false',
            maxSize: '256',
            maxFps: '1',
            bitrate: '64000',
        }))
            url.searchParams.set(key, value);
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.status.textContent = 'Connecting remote control…';
        this.ws.onmessage = (event) => {
            if (!(event.data instanceof ArrayBuffer)) return;
            const packet = new Uint8Array(event.data);
            if (packet[0] === ChannelId.METADATA) {
                this.ready = true;
                this.controls.forEach((button) => {
                    button.disabled = false;
                });
                this.status.textContent = 'Remote control connected.';
            }
            if (packet[0] === ChannelId.DEVICE_MSG) framer.push(packet.subarray(1));
        };
        this.ws.onclose = () => {
            this.ready = false;
            this.controls.forEach((button) => {
                button.disabled = true;
            });
            if (!this.stopped) this.status.textContent = 'Remote control disconnected. Reopen this panel to retry.';
        };
        this.ws.onerror = () => {
            if (!this.stopped) this.status.textContent = 'Remote control connection failed.';
        };
        this.image.tabIndex = 0;
        this.image.setAttribute('aria-label', 'Shield preview: use arrow keys, Enter and Escape to navigate');
        this.image.addEventListener('keydown', (event) => {
            const code = (
                {
                    ArrowUp: 19,
                    ArrowDown: 20,
                    ArrowLeft: 21,
                    ArrowRight: 22,
                    Enter: 23,
                    Escape: 4,
                    Backspace: 67,
                } as Record<string, number>
            )[event.key];
            if (code) {
                event.preventDefault();
                this.key(code);
            }
        });
    }
}
