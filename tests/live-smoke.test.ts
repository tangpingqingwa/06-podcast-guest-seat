import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("offline smoke rejects malformed LIVE_SMOKE_PORT before any request", () => {
  for (const port of ["80@api.waffo.ai", "80/foo", "0", "65536", "+80", ""]) {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      WAFFO_MODE: "fixture",
      LIVE_SMOKE_PORT: port,
    };
    delete childEnv.CI;
    delete childEnv.GITHUB_ACTIONS;
    delete childEnv.LIVE_SMOKE_BASE;

    const result = spawnSync("bash", [join(root, "scripts/live-smoke.sh")], {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.equal(result.error, undefined, port);
    assert.equal(result.status, 1, port);
    assert.match(output, /LIVE_SMOKE_PORT must be a pure decimal integer from 1 to 65535/, port);
    assert.doesNotMatch(output, /api\.waffo\.ai|pancake\.waffo\.ai/, port);
    assert.doesNotMatch(output, /src\/server\.ts|RESULT\t/, port);
  }
});

test("offline smoke fixes the fixture child to loopback despite inherited LISTEN_HOST", () => {
  for (const listenHost of ["0.0.0.0", "0.0.0.0@api.waffo.ai"]) {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      WAFFO_MODE: "fixture",
      LISTEN_HOST: listenHost,
    };
    delete childEnv.CI;
    delete childEnv.GITHUB_ACTIONS;
    delete childEnv.LIVE_SMOKE_BASE;

    const result = spawnSync("bash", [join(root, "scripts/live-smoke.sh")], {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    assert.equal(result.error, undefined, listenHost);
    assert.equal(result.status, 0, listenHost);
    assert.match(output, /LISTENER PASS: fixture child bound only to 127\.0\.0\.1:[1-9][0-9]*/, listenHost);
    assert.match(output, /SUMMARY PASS=6 PASS-ERROR=0 FAIL=0/, listenHost);
    assert.doesNotMatch(output, /api\.waffo\.ai|pancake\.waffo\.ai/, listenHost);
  }
});
