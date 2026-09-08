## Step 1: Declare the canvas

Your repository already contains the finished visual assets and framework-free
helpers. Your first job is to make GitHub Copilot discover a project-scoped
extension.

<img
  width="700"
  alt="A dark split-flap Flip Clock canvas"
  src="../images/flip-clock-preview.webp"
/>

### 📖 Theory: Extension, canvas, and instance

A **Copilot extension** is a process discovered from an immediate subdirectory
of `.github/extensions/`. Its entry point must be named `extension.mjs`.

A **canvas** is one UI type declared by that extension. The runtime derives the
extension ID, while you choose:

- `canvasId`: the stable type ID, here `flip-clock`.
- `instanceId`: the temporary panel handle supplied to `open`.

`joinSession` connects the extension, and `createCanvas` keeps the declaration
next to its lifecycle handlers. The SDK is supplied by the local Copilot
runtime, so do not add it to `package.json`.

### ⌨️ Activity: Register `flip-clock`

1. Create `.github/extensions/flip-clock/extension.mjs` with this declaration:

    ```js
    import {
        createCanvas,
        joinSession,
    } from "@github/copilot-sdk/extension";

    await joinSession({
        canvases: [
            createCanvas({
                id: "flip-clock",
                displayName: "Flip Clock",
                description:
                    "A serene split-flap clock with timezone, theme, and motion controls.",
                open: async () => ({
                    title: "Flip Clock",
                    status: "Renderer arrives in Step 2",
                }),
            }),
        ],
    });
    ```

1. Commit the new file directly to `main`.

The **Step 1** workflow checks the extension location, SDK import, session
registration, and canvas metadata. If a check fails, fix the reported item and
push again; the workflow is intentionally retriggerable.

<details>
<summary>Having trouble? 🤷</summary><br/>

- Confirm the file is exactly
  `.github/extensions/flip-clock/extension.mjs`.
- Keep the canvas ID lowercase and hyphenated: `flip-clock`.
- Do not install `@github/copilot-sdk`; GitHub Actions grades this step
  statically because the SDK is bundled only with the desktop/CLI runtime.

</details>
