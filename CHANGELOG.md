# Shield Controller changelog

### TLS security — October 2026

Update image trust stores and TLS components following the eMudhra incident. Checks cover the compromised chains, including both No CT cases, and a valid HTTPS connection. Running images remain unchanged: schedule their replacement after validation.

[Incident details](https://emudhra.we-have-a-problem.com/) · [TLS checks](security/emudhra/README.md)


## 2026-10-27

- Add TV maintenance: persistent references with selective drift repair, live Home button testing, compatibility diagnostics and essential/persistent TV component protections, contextual before/after measurements, and optional SHA-256-verified TV Detox 1.5.6 installation/configuration. Native features without executing upstream scripts.

## 2026-10-25

- Add the Settings and tweaks panel (HDMI-CEC, frame rate, long-press, animations, surround sound, density, default launcher) with restore to original, confirmed recommended cleanup, bulk re-enable of apps disabled by Shield Controller, and snapshots (save, preview differences, apply). Inspired by bryanroscoe/shield_optimizer, without reusing its code.

## 2026-10-18

- Remove language/theme controls from popups and the redundant cross in terminal close confirmation; Cancel, Close and Escape remain available.

- Automatic public IP/DNS detection on opening, grouped actions, panels without duplicate language/theme controls or tabs, no dedicated Projectivy diagnostics, and translated network discovery guidance.

- Label known DNS services and identify other resolver network operators through RIPEstat (IPv4/IPv6); keep IPs visible if metadata is unavailable.

- Fix invisible device panels by spanning the full tracker grid; Chromium and Firefox desktop/mobile regression coverage.

- Side panels, FR/EN flags, readable storage and launcher names.
- HTTP preview before capture, remote control and scrcpy text/Unicode clipboard input.
- Public IPv4/IPv6 and observed DNS resolvers through IPleak tests run on the Shield.
- Removed irrelevant Docker settings tabs and clarified the HTTP video notice.

- CPU/RAM/disk monitoring, Android thermal sensors and default launcher/foreground application.

- Consistent device action buttons and a remembered French/English switch.
- PNG screenshots with preview and download.
- IPv4/IPv6 DNS diagnostics, custom domains and Private DNS settings with readback and rollback on failure.
- Logo favicon and footer links to GitHub, UpAndClear, Ko-fi and the original project.

- Restore remembered ADB connections after a server restart.
- Fix Docker health checks when sign-in is enabled.

- Added detailed device information.
- Added drag-and-drop APK installation with upload progress.
- Added application search, filters and uninstall confirmation.
- Added concise French and English READMEs.

Based on ws-scrcpy-web 0.5.10, commit `b32d7693f7d42b0febf2399397fcfd5fb09af161`.
