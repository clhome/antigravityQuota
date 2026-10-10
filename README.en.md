# antigravityQuota

<img src="https://raw.githubusercontent.com/clhome/antigravityQuota/main/assets/icon.png" width="96" alt="antigravityQuota" />

One job only: **view your Antigravity quota inside the editor**.

This is a slim fork of
[`antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit). The original
auto wake-up, multi-account management and auto-switching, online announcements, quota history
charts, Cockpit Tools bridge and Antigravity Tools credential import have been **removed
entirely**. What remains is a status bar item plus a minimal quota dashboard.

## Install

- **Marketplace**: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=clhome.antigravity-quota)
  · [Open VSX](https://open-vsx.org/extension/clhome/antigravity-quota)
- **Offline**: download the `.vsix` from [Releases](https://github.com/clhome/antigravityQuota/releases)
  and run `code --install-extension antigravity-quota-<version>.vsix`

## Features

- **Status bar**: shows the lowest remaining quota; hover for the full breakdown.
- **Quota dashboard**: a minimal webview listing each model's remaining percentage and reset countdown.
- **Native notifications**: one alert when a quota is exhausted or running low.
- **16 languages**: follows the editor locale, or pick one in the settings.

## Data source (important)

Quota is read from exactly one place: the language server that your local Antigravity
process starts on `127.0.0.1:<random port>`, authenticated with the CSRF token that
process generates for itself.

Consequently this extension:

- never requests or stores Google / OAuth credentials;
- never talks to any external host (no network egress other than loopback);
- has no scheduled wake-up, no account switching, no multi-account storage.

Trade-off: Antigravity must be running, and only the **currently signed-in account**
is reported.

> In WSL / remote containers the local language server is usually not reachable.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `antigravityQuota.refreshInterval` | `300` | Refresh interval in seconds. **Hard floor of 60s**, ceiling 3600 |
| `antigravityQuota.statusBarFormat` | `standard` | icon / dot / percent / compact / namePercent / standard |
| `antigravityQuota.warningThreshold` | `30` | Warning threshold (%) |
| `antigravityQuota.criticalThreshold` | `10` | Critical threshold (%) |
| `antigravityQuota.notificationEnabled` | `true` | Show quota notifications |
| `antigravityQuota.dataMasked` | `false` | Mask account name and email |
| `antigravityQuota.logLevel` | `info` | Log level |
| `antigravityQuota.language` | `auto` | UI language (16 locales) |

## Commands

| Command | Command ID | Description |
| --- | --- | --- |
| `Antigravity: Open Quota Dashboard` | `antigravityQuota.open` | Open the dashboard (`Ctrl/Cmd+Shift+Q`) |
| `Antigravity: Refresh Quota` | `antigravityQuota.refresh` | Refresh now (60s cooldown) |
| `Antigravity: Show Logs` | `antigravityQuota.showLogs` | Open the output channel |
| `Antigravity: Purge Legacy Plaintext Credentials` | `antigravityQuota.purgeLegacyData` | Scan for and delete leftovers written by older Antigravity Cockpit versions |

## Security

See [`docs/安全加固说明.md`](docs/安全加固说明.md) (Chinese). Summary:

- **No credentials**: all OAuth code and the `client_secret` constant are gone.
- **No external calls**: only loopback requests at runtime; announcement fetching and tool bridges removed.
- **No wake-up**: the scheduled trigger that sent empty model requests is gone.
- **Strict CSP**: nonce-based scripts, no `unsafe-inline` / `unsafe-eval`, `connect-src 'none'`,
  images limited to extension-local resources and `data:`.
- **Rate-limit friendly**: 60s hard floor, ±10% jitter, exponential backoff on failure.
- **Legacy cleanup**: a command that scans and removes plaintext credential leftovers in `~/.antigravity_cockpit`.
- **Source-level regression tests**: `src/test/security_invariants.test.ts` pins these guarantees.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run build      # or npm run watch
npm test
```

Requires Node.js 20+.

## License & origin

- Slim fork of [`jlcodes99/vscode-antigravity-cockpit`](https://github.com/jlcodes99/vscode-antigravity-cockpit).
- License: [Apache-2.0](LICENSE).

## Releasing

See [`docs/PUBLISH.md`](docs/PUBLISH.md) (Chinese): one-command `npm run release`, plus GitHub
Actions publishing to the VS Code Marketplace and Open VSX on every `v*` tag.
