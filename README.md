# Shield Controller

<p align="center">
  <img src="assets/branding/shield-controller-logo.png" alt="Shield Controller" width="180">
</p>

Manage your **NVIDIA Shield / Android TV** from a browser. Self-hosted with Docker.

[Français](README.fr.md) · [Upstream project](https://github.com/bilbospocketses/ws-scrcpy-web)

## Features

- Live screen mirroring and remote control: D-pad, keyboard and mouse.
- Detailed device information: Android, hardware, RAM, storage, network and display.
- Drag-and-drop APK installation with upload progress and Android error messages.
- Application list with search, user/system/disabled filters and uninstall confirmation.
- Remembered devices reconnect automatically at startup.
- File browser, transfers and ADB terminal inherited from ws-scrcpy-web.

## Docker

For **Linux amd64**, use this Compose file in Dockge or with `docker compose up -d`:

```yaml
services:
  shield-controller:
    image: ghcr.io/aerya/shield-controller:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8123:8000"
    environment:
      WS_SCRCPY_ALLOW_REMOTE_ADMIN: "1"
    volumes:
      - ./data:/data
```

Open **http://localhost:8123** on the Docker host. For access from another device, configure an HTTPS reverse proxy and authentication. The environment variable above grants administrative access to anyone able to reach the service.

Build locally: `docker build -t shield-controller:local .`

## Connect your Shield

1. Enable developer options: **Settings → Device Preferences → About → press Build 7 times**.
2. Enable **Network debugging** and note the Shield's IP address.
3. Add `SHIELD_IP:5555` in the WebUI and accept the authorization prompt on the TV.
4. Use **device info** or **applications / APK** on the device card.

Ethernet and Wi-Fi both work. No router port forwarding is needed.

## Notes

Single `.apk` files only, up to **512 MiB each**; split bundles (`.apks`, `.xapk`) are unsupported. Installs update existing apps when Android permits it. Uninstall targets **Android user 0**; removing system apps can break TV functions. App names are shown as package identifiers. Some device details may be unavailable without root. Protected video may appear black in screen mirroring.

## Credits & license

Based on **[bilbospocketses/ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web)**, with device management additions by Aerya. Screen mirroring uses **[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)**.

**GPL-3.0-only** — see [LICENSE](LICENSE). Upstream copyright notices are preserved.
