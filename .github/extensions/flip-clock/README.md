# Flip Clock starter

The renderer and its framework-free support modules are ready for the exercise.
The extension is intentionally **not discoverable yet** because
`extension.mjs` does not exist. Step 1 in the exercise issue will guide you
through creating it.

The finished project-scoped extension will have this shape:

```text
.github/extensions/flip-clock/
├── assets/
├── lib/
├── copilot-extension.json
└── extension.mjs
```

Run the supplied module tests at any time:

```bash
node --test .github/extensions/flip-clock/tests/*.test.mjs
```

> [!NOTE]
> Canvas APIs are experimental. GitHub Actions and Codespaces can grade the
> files, but displaying the live canvas requires the GitHub Copilot desktop/CLI
> runtime on a supported local machine.
