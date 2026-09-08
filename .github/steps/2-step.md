## Step 2: Serve the renderer safely

The declaration is discoverable, but it does not yet return a page. Connect it
to the supplied renderer in `lib/server.mjs`.

### 📖 Theory: Canvas lifecycle

The host embeds the URL returned by `open`. A canvas renderer should bind to
`127.0.0.1` on port `0`, letting the operating system choose a free loopback
port.

`open` must be idempotent: reloads and reconnects can call it again for the same
`instanceId`. Reuse one server per open panel, then stop it in `onClose` so the
extension does not leak ports.

### ⌨️ Activity: Wire `open` and `onClose`

1. Import `startClockServer` and create a module-level server map:

    ```js
    import { startClockServer } from "./lib/server.mjs";

    const servers = new Map();
    ```

1. Replace the canvas `open` handler with a get-or-start lifecycle:

    ```js
    open: async (ctx) => {
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startClockServer({
                instanceId: ctx.instanceId,
            });
            servers.set(ctx.instanceId, entry);
        }

        return { title: "Flip Clock", url: entry.url };
    },
    ```

1. Add cleanup beside `open`, then commit and push:

    ```js
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) {
            servers.delete(ctx.instanceId);
            await entry.close();
        }
    },
    ```

The supplied server already serves the polished assets, binds only to loopback,
and uses a fresh token in the canvas URL. The **Step 2** workflow checks your
lifecycle wiring and runs the deterministic server tests.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Keep `servers` outside `open`; otherwise every call creates a new map.
- Store the complete entry returned by `startClockServer`, not only its URL.
- `instanceId` is appropriate for this temporary server map, but not for
  durable user data. Step 3 introduces the stable preference store.

</details>
