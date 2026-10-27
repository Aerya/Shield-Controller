# Shield Controller

<p align="center">
  <img src="assets/branding/shield-controller-logo.png" alt="Shield Controller" width="180">
</p>

Manage your **NVIDIA Shield / Android TV** from a browser. Self-hosted with Docker.

[Français](README.fr.md)

### TLS security — October 2026

Update image trust stores and TLS components following the eMudhra incident. Checks cover the compromised chains, including both No CT cases, and a valid HTTPS connection. Running images remain unchanged: schedule their replacement after validation.

[Incident details](https://emudhra.we-have-a-problem.com/) · [TLS checks](security/emudhra/README.md)

## Features

- Screen preview and remote control: D-pad, keyboard and text input
- Detailed information: Android, hardware, RAM, storage, network and display
- Drag-and-drop APK installation with upload progress and Android error messages
- Application list with search, user/system/disabled filters and uninstall confirmation
- Remembered devices reconnect automatically at startup
- File browser, transfers and ADB terminal
- French/English interface with tool panels to the right of the device
- PNG screenshots with preview and download, including over LAN HTTP
- Automatic public IP and IPv4/IPv6 DNS detection with provider names, domain tests and Android Private DNS
- HDMI-CEC, frame rate, long-press, animation, surround sound, display density and default launcher settings, with restore to original
- Confirmed recommended cleanup, bulk re-enable, and snapshots to roll back or copy a setup
- CPU, RAM, storage, available temperatures, Android-declared home and foreground application monitoring (optional refresh every 5 seconds).

## Screenshots

| | |
| --- | --- |
| **Remote control and text pasting**<br>[![Remote control and text pasting](assets/screenshots/remote-control.png)](assets/screenshots/remote-control.png) | **Overview and network discovery**<br>[![Overview and network discovery](assets/screenshots/overview.png)](assets/screenshots/overview.png) |
| **ADB terminal**<br>[![ADB terminal](assets/screenshots/terminal.png)](assets/screenshots/terminal.png) | **File browser**<br>[![File browser](assets/screenshots/files.png)](assets/screenshots/files.png) |
| **Public IPs and IPv4/IPv6 DNS**<br>[![Public IPs and IPv4/IPv6 DNS](assets/screenshots/dns.png)](assets/screenshots/dns.png) | **Applications and APK installation**<br>[![Applications and APK installation](assets/screenshots/applications.png)](assets/screenshots/applications.png) |
| **Stream settings**<br>[![Stream settings](assets/screenshots/stream-settings.png)](assets/screenshots/stream-settings.png) | **Screenshot preview**<br>[![Screenshot preview](assets/screenshots/screenshot.png)](assets/screenshots/screenshot.png) |

## Optimization

The panel opens in **Everyday optimization**: telemetry, diagnostics, Plex, user apps, and disabled or protected apps. **Advanced — all applications** exposes the full inventory without removing any option. Dedicated filters also show system components, user apps and protected apps. Apps whose system status is unknown remain visible in the default view.

Known apps have readable names and explanations of their purpose and the consequences of disabling them. This information comes from a curated catalog, not APK label extraction. Unknown packages are explicitly identified as such; their technical identifiers remain visible and searchable. Search matches translated names, package identifiers and explanations within the selected view. Lists use 12 apps per page with a counter, grouped actions, and diagnostics and protection information above the list on desktop and mobile.

The **Optimization** panel lists apps for the active Android user, a process CPU snapshot, memory and storage. A snapshot does not establish that an app slows down boot.

Individual actions are **Disable**, **Enable**, **Protect**, and **Remove manual protection**. Disabling preserves data but stops the app’s functions and services until enabled again. Filters distinguish NVIDIA/Google telemetry and feedback, NVIDIA diagnostics, the local Plex server (`com.plexapp.mediaserver.smb`) and Plex player (`com.plexapp.android`). Plex database maintenance and Scrob are out of scope.

Before each disable (and in the existing uninstall API), the server checks the resolved home launcher, foreground app and published media sessions (including paused sessions). **Protect** your usual player to keep it protected when closed or when it does not publish a media session. Nothing is disabled without your confirmation. If Android cannot provide reliable protection information, disabling requires a fresh valid diagnostic; enabling remains available.

Persistent history retains the last 200 attempts per device and Android user under the server data directory (`optimization/`), including time, action and result. A pending entry may have been interrupted: refresh the actual device state before retrying. Enable apps again using the disabled apps filter. Detection cannot guarantee protection against a simultaneous app switch on the TV.

**Recommended cleanup** offers a short list maintained by Shield Controller. NVIDIA/Google telemetry and feedback are preselected. Optional items (NVIDIA diagnostics, home-screen recommendations, local Plex server, preinstalled apps) are unticked. Apps already disabled or protected are not shown. After confirmation, each app goes through the same protections and checks as an individual disable. Only packages from this list can be disabled in a batch.

**Re-enable apps disabled here** undoes, in one go, the disables made by Shield Controller according to its history. Packages disabled by the firmware itself are left alone; the result lists any re-enable Android refused.

## Settings and tweaks

The **Settings and tweaks** panel changes documented Android settings, each limited to an allowlist of values and verified after writing:

- HDMI-CEC, turning the TV on and off with the Shield
- Match content frame rate (Android 12+; on the Shield, use the NVIDIA setting in the TV menu)
- Remote long-press delay
- Animation scales (window, transition, duration)
- Surround sound output (automatic, never, always, manual)
- Display scaling (density from 160 to 640 dpi, resettable)
- Default launcher among installed home screens

The value seen before the first change is kept on the server (`tweaks/`): **Restore original** puts it back. Settings unavailable on the device’s Android version are greyed out. Private DNS stays in the DNS panel.

### Snapshots

**Save snapshot** downloads a JSON file with each app’s enabled/disabled state, the settings above, density and launcher. **Load snapshot** first shows the differences with the device, then **Apply snapshot** applies them. On the same device this rolls back; on another one it copies the setup.

The launcher changes first, then re-enables, settings, density and finally disables. Protections still apply. Missing apps, unavailable settings and “Android default” values are skipped and listed. Each step’s result is shown; a refused step does not stop the others.

### TV maintenance

In **Settings and tweaks → TV maintenance**:

- **Save reference configuration**, then **Check my configuration** after an update: differences are displayed without changing the TV. Select the desired changes and confirm **Restore selected differences**. Protections still apply and skipped items remain visible. References persist on the server under `maintenance/`, per device (ADB identifier) and Android user, independently of downloadable JSON snapshots. A different ADB address creates a separate reference. Unrestorable “Android default” settings are reported as skipped.
- **Test Home button** explicitly opens Settings and presses Home after confirmation. Select the expected launcher; the report shows the observed application. Restoring the original launcher on failure is optional and requires an original recorded by Shield Controller. Unrecognized vendor routing is reported as unverified; no launcher is disabled and no reboot is performed. This interrupts the current TV screen.
- **Compatibility** identifies Google TV and known TV components (HDMI, remote, setup, Cast, screensaver…). Known essential components and packages marked `PERSISTENT` are protected against disabling and uninstalling. The catalog is not exhaustive; unknown applications are not declared safe to disable. Keep the screensaver enabled on OLED displays.
- **Measure before / Measure after** compares available RAM, a one-second CPU sample and uptime. The before measurement persists. A different or unknown boot is explicitly reported: these figures do not prove a speed improvement. Use comparable workloads.
- **Install TV Detox** optionally installs the TV Detox Android launcher, pinned to **1.5.6**, downloaded from its official release and verified by SHA-256. Installation is limited to Android user 0, keeps the stock launcher enabled and never uninstalls an existing app on a signature conflict. The server needs outbound Internet access to GitHub. Once installed, configure application order (package identifiers), Bluetooth/sound/picture shortcuts and clock format, then open the launcher from this panel. Sending configuration replaces these options; the panel does not read the launcher's internal preferences. Shortcut availability depends on firmware. To select it as Home, refresh **Settings and tweaks**, choose **Default launcher** and test Home. Google TV may keep opening its stock home screen; Shield Controller does not force replacement by disabling it.

These features are implemented natively in Shield Controller. No external `install.sh`, `check.sh` or cleanup script is executed. Only the optional launcher is a separate Android application. Installation does not guarantee compatibility with every model. Automated validation uses simulated ADB responses; firmware-specific behavior still needs verification on the device.

## Docker

For **Linux amd64**, use this Compose file in Dockge or with `docker compose up -d`:

```yaml
services:
  shield-controller:
    image: ghcr.io/aerya/shield-controller:latest
    restart: unless-stopped
    ports:
      - "8123:8000"
    environment:
      WS_SCRCPY_ALLOW_REMOTE_ADMIN: "1"
    volumes:
      - ./data:/data
```

Open **http://SERVER_IP:8123** on your LAN. **View / Control** works over HTTP: refreshed screen preview, remote control, pasting and text input. The inherited continuous video stream requires a secure browser context. The variable above grants administrative access to anyone able to reach the service; sign-in is available in Settings → Users.

Build locally: `docker build -t shield-controller:local .`

## Connect your Shield

1. Enable developer options: **Settings → Device Preferences → About → press Build 7 times**.
2. Enable **Network debugging** and note the Shield's IP address.
3. Add `SHIELD_IP:5555` in the WebUI and accept the authorization prompt on the TV.
4. Use **device info** or **applications / APK** on the device card.

Ethernet and Wi-Fi both work. No router port forwarding is needed.

## Remote control and text

Open **View / Control**, select the TV input field with the remote, paste your URL/username in the text box, then click **Paste on Shield**. If the app blocks pasting, try **Type text directly** (300 bytes maximum; non-Latin characters are limited). Shield Controller does not store the text; pasting uses Android’s clipboard. The HTTP preview updates about every 1.5 seconds plus capture time, without audio.

## Notes

Single `.apk` files only, up to **512 MiB each**; split bundles (`.apks`, `.xapk`) are unsupported. Installs update existing apps when Android permits it. Uninstall targets **Android user 0**; removing system apps can break TV functions. App names are shown as package identifiers. Some device details may be unavailable without root. Protected video may appear black in screen mirroring.

## DNS

Each resolver IP includes its known DNS service or network operator (RIPEstat); unavailable identification never hides the result.

Without a custom server, the test runs on the Shield. With an IPv4/IPv6 DNS address, it runs from the Shield Controller server. Private DNS uses a **provider hostname** (DNS-over-TLS). On an unrooted Android 11 Shield, change Ethernet DNS in the TV network settings or DHCP.

Opening the DNS panel automatically detects public IPs and DNS resolvers through [IPleak.net](https://ipleak.net/) from the Shield. It reports observed recursive resolvers, without reading AdGuard Home or listing root servers. Per-app VPN routing may differ.

## Credits & license

- **[Ansub/tv-detox](https://github.com/Ansub/tv-detox)** — inspiration for TV maintenance and provider of the optional Android launcher, under the [MIT license](https://github.com/Ansub/tv-detox/blob/main/LICENSE). Maintenance workflows and compatibility checks are implemented natively; no upstream shell scripts or Java source are incorporated. The APK is downloaded on request, not bundled.
- **[bilbospocketses/ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web)** — base project, with device management additions by Aerya.
- **[bryanroscoe/shield_optimizer](https://github.com/bryanroscoe/shield_optimizer)** (ATV Optimizer) — inspiration for settings, recommended cleanup, bulk re-enable and snapshots. Its author forbids using its code: no code or lists are taken from it; the features were rewritten from public Android commands.
- **[Genymobile/scrcpy](https://github.com/Genymobile/scrcpy)** — screen mirroring.

**GPL-3.0-only** — see [LICENSE](LICENSE). Upstream copyright notices are preserved.
