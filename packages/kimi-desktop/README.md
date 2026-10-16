# Kimi desktop Work agent

Use the ordinary **Kimi desktop application's local Work agent** with a model selected in Magpie. This is not Kimi Code CLI, a Kimi subscription provider, or a way to spend Kimi Work subscription credits in other agents.

```sh
magpie plugin add @magpie-community/agent-kimi-desktop
```

Open and sign in to Kimi desktop. On Magpie's Agents page select **Kimi**, pick a model, and connect. The adapter waits for the local Work runtime to be ready and idle, then applies the connection without restarting either application. Use Kimi's **Work** page. Chat and cloud Claw are outside its scope. The standard Kimi model menu continues to use the model selected in Magpie; this package does not modify Kimi's application resources or install a custom model-menu patch.

Disconnect Kimi in Magpie to restore its original model service address. Existing conversations, login credentials, unrelated settings, and native model entries are preserved.

## How it works

The import-free `kimi-desktop.agent.js` registers the agent using Magpie's agent interface. The Bun entry `index.mjs` is also necessary: Kimi's actual configuration belongs to its running local runtime, so changing a file alone does not reliably apply a model. It runs a loopback adapter and uses Kimi's authenticated local control API to reload the selected model.

Inference goes to Magpie using Magpie's agent credential. Kimi's web search/fetch tools continue through Kimi's original `agent-gw.kimi.com` service with Kimi's own credential. Kimi login credentials are never forwarded to Magpie or a third-party model provider. Requests to unknown paths and requests without Kimi authentication are rejected; no system proxy, certificate or firewall settings are changed.

The adapter does not reload a busy Work runtime. If Kimi independently changes its service configuration while connected, adaptation pauses instead of repeatedly overwriting it; disconnect and reconnect in Magpie to retry.

## Local files and compatibility

- `~/.config/magpie-kimi/connection.json`: Magpie's selected model and connection.
- `~/.config/magpie-kimi/status.json`: fixed status categories, without credentials.
- `~/.config/magpie-kimi/backups/`: original local configuration before connecting; may contain login information and must remain private.
- Kimi configuration: `kimi-desktop/daimon-share/daimon/config.json` under the platform's application-support directory.

Verified with Windows 11, Kimi 3.2.17.10 and official Magpie 0.1.1275, including an actual Work request through Magpie. macOS path discovery is implemented but a live macOS Work session has not been tested. The supported runtime has provider `daimon-kimi-code` with original service `https://agent-gw.kimi.com/coding/v1`; other layouts stop with `unsupported_kimi_config`. This internal Kimi protocol may change in later releases.

No Kimi binaries, personal configuration, prompts, account identifiers or credentials are included. There are no runtime dependencies. Tests use isolated temporary directories and synthetic credentials.

```sh
bun test packages/kimi-desktop/kimi-desktop.test.mjs
```

The model catalog respects Magpie's per-agent visibility, picked/hidden models, global disables and model order. Removed selections are refused on new requests even during a running turn. An existing separately installed native menu patch can use `menu-hook.cjs` to show only the selected models while connected; the package does not install or modify that client patch. The icon is Kimi's desktop application icon.
