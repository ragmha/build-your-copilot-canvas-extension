## Review

Congratulations, you built a complete project-scoped Copilot canvas extension.

<img
  width="700"
  alt="The completed Flip Clock canvas"
  src="../images/flip-clock-preview.svg"
/>

You:

- Registered a discoverable `flip-clock` canvas with `joinSession` and
  `createCanvas`.
- Managed one loopback renderer per panel and cleaned it up in `onClose`.
- Added a schema-validated agent action backed by stable user preferences.
- Preserved the JSON-RPC boundary, renderer security, accessibility, and
  reduced-motion behavior.
- Added the extension manifest and ran deterministic tests without depending on
  the desktop-bundled SDK.

### What's next?

- Try opening two Flip Clock instances and confirm that they share preferences
  but use separate renderer ports.
- Add a second agent-facing action, such as restoring defaults.
- Explore the bundled Copilot SDK extension guide and canvas type definitions
  from a supported local runtime.

> [!NOTE]
> Canvas APIs are experimental. Keep extension wiring small and isolate
> testable logic in ordinary modules so future SDK changes are easier to adopt.
