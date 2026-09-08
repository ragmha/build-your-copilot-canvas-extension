## Step 3: Add a validated action and durable preferences

The clock now renders, but each server uses temporary defaults. Give the canvas
one agent-facing action and one shared preference store.

### 📖 Theory: Actions are not iframe controls

Canvas `actions` are callable by Copilot through the runtime. They are not
automatically rendered as buttons. The settings dialog in the supplied HTML
uses ordinary loopback HTTP endpoints; both paths update the same store.

The runtime validates an action's JSON Schema before calling its handler.
Handlers return the raw result. For expected failures, throw `CanvasError`
instead of returning an `{ ok, error }` wrapper.

`instanceId` identifies a panel, not durable data. The supplied
`createPreferenceStore` writes user-wide settings under
`$COPILOT_HOME/extensions/flip-clock/artifacts/`, so a new panel or session
still sees the same clock preferences.

### ⌨️ Activity: Share and configure preferences

1. Replace the existing SDK import with the expanded version below. Then add
   the preference import and create one store beside the `servers` map:

    ```js
    import {
        CanvasError,
        createCanvas,
        joinSession,
    } from "@github/copilot-sdk/extension";
    import {
        PREFERENCE_SCHEMA_PROPERTIES,
        PreferenceValidationError,
        createPreferenceStore,
    } from "./lib/preferences.mjs";

    const preferenceStore = createPreferenceStore();
    ```

1. Add one `configure` entry to the canvas `actions` array:

    ```js
    {
        name: "configure",
        description:
            "Change the clock timezone, hour cycle, theme, or motion preference.",
        inputSchema: {
            type: "object",
            properties: PREFERENCE_SCHEMA_PROPERTIES,
            additionalProperties: false,
            minProperties: 1,
        },
        handler: async (ctx) => {
            try {
                return await preferenceStore.update(ctx.input ?? {});
            } catch (error) {
                if (error instanceof PreferenceValidationError) {
                    throw new CanvasError(error.code, error.message);
                }
                throw error;
            }
        },
    }
    ```

1. Pass `preferenceStore` to `startClockServer`, then commit and push:

    ```js
    entry = await startClockServer({
        instanceId: ctx.instanceId,
        preferenceStore,
    });
    ```

The **Step 3** workflow checks the action schema, raw return value, shared store,
and stable storage scope. It also runs the preference tests.

<details>
<summary>Having trouble? 🤷</summary><br/>

- The action name is exactly `configure`; names beginning with `canvas.` are
  reserved.
- Pass `PREFERENCE_SCHEMA_PROPERTIES` as `properties`, not as the entire
  schema.
- Return the updated preferences directly from the handler.

</details>
