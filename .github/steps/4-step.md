## Step 4: Harden, test, and package

The extension is functional. Finish it as a shareable, inspectable project
extension.

### 📖 Theory: Respect the runtime boundary

Extension processes speak JSON-RPC over stdout, so `console.log` can corrupt the
protocol. Use `session.log` for user-visible diagnostics or stderr for local
debug output.

The supplied renderer demonstrates the other important boundaries:

- Loopback-only binding and a random per-server URL token.
- A restrictive Content Security Policy and same-origin write checks.
- Accessible text for the visual clock and reduced-motion behavior.
- Pure Node modules and deterministic tests that do not import the
  desktop-bundled SDK.

A `copilot-extension.json` manifest makes the folder recognizable to extension
sharing and installation tools.

### ⌨️ Activity: Finish the extension

1. Create `.github/extensions/flip-clock/copilot-extension.json`:

    ```json
    {
      "name": "flip-clock",
      "version": 1
    }
    ```

1. Run the complete local checks:

    ```bash
    node --check .github/extensions/flip-clock/extension.mjs
    node --test .github/extensions/flip-clock/tests/*.test.mjs
    node .github/scripts/grade.mjs 4 --cumulative
    ```

1. Commit and push the manifest. The **Step 4** workflow performs the final
   deterministic checks and completes the exercise.

### Optional: Open the live canvas locally

GitHub Actions and Codespaces cannot render a host canvas. On a supported local
machine, open this repository in GitHub Copilot desktop/CLI and ask Copilot to:

1. Run `extensions_reload`.
1. Inspect the `flip-clock` extension and its log.
1. Open canvas ID `flip-clock` with an instance ID such as `clock-1`.
1. Invoke `configure` with a timezone, theme, hour cycle, or motion setting.

The runtime may re-run `open` after a reload. Your server map makes that safe,
and `onClose` releases the port when the panel closes.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Check that the manifest is valid JSON with numeric version `1`.
- Search the extension entry point and server for `console.log`.
- If local discovery fails, confirm the entry point is named
  `extension.mjs`, reload extensions, then inspect the extension log.

</details>
