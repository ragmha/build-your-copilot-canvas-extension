import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../..", import.meta.url);

async function read(relativePath) {
    return fs.readFile(new URL(relativePath, root), "utf8");
}

test("the repository is a learner starter, not the solution", async () => {
    await assert.rejects(
        fs.access(new URL(".github/extensions/flip-clock/extension.mjs", root)),
    );
    await assert.rejects(
        fs.access(
            new URL(
                ".github/extensions/flip-clock/copilot-extension.json",
                root,
            ),
        ),
    );
});

test("all four lessons and the review are present", async () => {
    const steps = await Promise.all(
        ["1-step.md", "2-step.md", "3-step.md", "4-step.md", "x-review.md"].map(
            (name) => read(`.github/steps/${name}`),
        ),
    );

    assert.match(steps[0], /joinSession/);
    assert.match(steps[1], /127\.0\.0\.1/);
    assert.match(steps[2], /`instanceId` identifies a panel/);
    assert.match(steps[3], /console\.log/);
    assert.match(steps[4], /Canvas APIs are experimental/);
});

test("workflow chain uses the pinned toolkit and current checkout action", async () => {
    const workflowDirectory = new URL(".github/workflows/", root);
    const names = (await fs.readdir(workflowDirectory))
        .filter((name) => name.endsWith(".yml"))
        .sort();

    assert.deepEqual(names, [
        "0-start-exercise.yml",
        "1-step.yml",
        "2-step.yml",
        "3-step.yml",
        "4-last-step.yml",
        "validate-source.yml",
    ]);

    for (const name of names) {
        const workflow = await read(`.github/workflows/${name}`);
        assert.doesNotMatch(workflow, /replace-me/);
        if (name !== "0-start-exercise.yml") {
            assert.match(workflow, /actions\/checkout@v6/);
        }
        if (name !== "validate-source.yml") {
            assert.match(workflow, /skills\/exercise-toolkit/);
            assert.doesNotMatch(
                workflow,
                /skills\/exercise-toolkit[^@\n]*@(?!v0\.9\.1)/,
            );
        }
    }
});

test("step triggers are narrow and advance one workflow at a time", async () => {
    const step1 = await read(".github/workflows/1-step.yml");
    const step2 = await read(".github/workflows/2-step.yml");
    const step3 = await read(".github/workflows/3-step.yml");
    const step4 = await read(".github/workflows/4-last-step.yml");

    for (const workflow of [step1, step2, step3]) {
        assert.match(
            workflow,
            /paths:\s*\n\s+- "\.github\/extensions\/flip-clock\/extension\.mjs"/,
        );
        assert.match(workflow, /gh workflow disable/);
        assert.match(workflow, /--repo "\$\{\{ github\.repository \}\}" \|\| true/);
        assert.match(workflow, /gh workflow enable "Step [234]"/);
        assert.match(workflow, /comment-author: "github-actions\[bot\]"/);
    }

    assert.match(
        step4,
        /paths:[\s\S]*"\.github\/extensions\/flip-clock\/extension\.mjs"[\s\S]*"\.github\/extensions\/flip-clock\/copilot-extension\.json"/,
    );
    assert.match(step4, /finish-exercise\.yml@v0\.9\.1/);
    assert.match(
        step4,
        /node --check \.github\/extensions\/flip-clock\/extension\.mjs/,
    );
    assert.match(step4, /comment-author: "github-actions\[bot\]"/);
    assert.match(step4, /--repo "\$\{\{ github\.repository \}\}" \|\| true/);
});

test("source validation runs only in the template repository", async () => {
    const workflow = await read(".github/workflows/validate-source.yml");

    assert.match(
        workflow,
        /github\.repository == 'ragmha\/build-your-copilot-canvas-extension'/,
    );
    assert.match(workflow, /node --test/);
    assert.match(workflow, /node \.github\/scripts\/grade\.mjs 4/);
});

test("README contains the official copy flow and runtime limitation", async () => {
    const readme = await read("README.md");

    assert.match(
        readme,
        /template_owner=ragmha&template_name=build-your-copilot-canvas-extension/,
    );
    assert.match(readme, /canvas API is experimental/i);
    assert.match(readme, /Codespaces and GitHub Actions/);
    assert.match(readme, /independent personal project/);
});

test("the supplied implementation contains no user runtime state", async () => {
    const extensionDirectory = new URL(
        ".github/extensions/flip-clock/",
        root,
    );
    const entries = [];

    async function walk(directory, prefix = "") {
        for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
        })) {
            const relativePath = join(prefix, entry.name);
            if (entry.isDirectory()) {
                await walk(new URL(`${entry.name}/`, directory), relativePath);
            } else {
                entries.push(relativePath);
            }
        }
    }

    await walk(extensionDirectory);
    assert.equal(
        entries.some((path) => path.includes("artifacts/")),
        false,
    );
    assert.equal(
        entries.some((path) => path.endsWith(".preferences.json")),
        false,
    );
});
