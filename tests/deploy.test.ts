import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeIcons = [
  "bitcoin.svg",
  "bot.svg",
  "chevron-down.svg",
  "chevron-right.svg",
  "code-xml.svg",
  "globe.svg",
  "heart-pulse.svg",
  "layout-grid-light.svg",
  "linkie.svg",
  "megaphone.svg",
  "moon.svg",
  "outbid-mark.svg",
  "rail-bot.svg",
  "rail-megaphone.svg",
  "scale.svg",
  "search-check-accent.svg",
  "search-check.svg",
  "search.svg",
  "share-2.svg",
  "shield-check.svg",
  "trophy.svg",
] as const;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function freeLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => resolveListen());
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    probe.close();
    throw new Error("failed to allocate a loopback port");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) => {
    probe.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return port;
}

function stageRuntime(): string {
  const stage = mkdtempSync(join(tmpdir(), "podcast-guest-seat-docker-stage-"));
  cpSync(join(root, "src"), join(stage, "src"), { recursive: true });
  cpSync(join(root, "public"), join(stage, "public"), { recursive: true });
  cpSync(join(root, "package.json"), join(stage, "package.json"));
  cpSync(join(root, "package-lock.json"), join(stage, "package-lock.json"));
  cpSync(join(root, "tsconfig.json"), join(stage, "tsconfig.json"));
  symlinkSync(join(root, "node_modules"), join(stage, "node_modules"), "dir");
  mkdirSync(join(stage, "data"));
  return stage;
}

type StartedServer = {
  child: ChildProcess;
  baseUrl: string;
  databasePath: string;
  output: () => string;
};

async function startStagedServer(stage: string, listenHost: "127.0.0.1" | "0.0.0.0"): Promise<StartedServer> {
  const port = await freeLoopbackPort();
  const databasePath = join(stage, "data", `guest-seat-${listenHost.replaceAll(".", "-")}.sqlite`);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: stage,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      WAFFO_MODE: "fixture",
      LISTEN_HOST: listenHost,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      HOST_SESSION_SECRET: "docker-runtime-fixture-host",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let lastError = "server did not become healthy";
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`staged server exited ${child.exitCode}: ${stderr || stdout}`);
      }
      try {
        const response = await fetch(`${baseUrl}/healthz`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          await response.arrayBuffer();
          return { child, baseUrl, databasePath, output: () => `${stdout}${stderr}` };
        }
        lastError = `health status ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await wait(50);
    }
  } catch (error) {
    await stopServer(child);
    throw error;
  }
  await stopServer(child);
  throw new Error(`${lastError}: ${stderr || stdout}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  child.kill("SIGTERM");
  await Promise.race([exited, wait(3_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, wait(3_000)]);
  }
}

test("Docker runtime staging copies public icons and serves the loopback app", async () => {
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const serverSource = readFileSync(join(root, "src/server.ts"), "utf8");
  assert.match(dockerfile, /^COPY public \.\/public$/m);
  assert.match(dockerfile, /test -s \/app\/public\/icons\/bitcoin\.svg/);
  assert.match(dockerfile, /LISTEN_HOST=0\.0\.0\.0/);
  assert.match(serverSource, /env\.LISTEN_HOST/);
  assert.match(serverSource, /app\.listen\(\{ host: listenHost, port \}\)/);

  for (const icon of runtimeIcons) {
    assert.ok(existsSync(join(root, "public", "icons", icon)), `missing runtime icon ${icon}`);
  }

  const stage = stageRuntime();
  try {
    for (const listenHost of ["127.0.0.1", "0.0.0.0"] as const) {
      const server = await startStagedServer(stage, listenHost);
      try {
        const health = await fetch(`${server.baseUrl}/healthz`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { ok: true });
        const asset = await fetch(`${server.baseUrl}/icons/bitcoin.svg`);
        assert.equal(asset.status, 200);
        assert.match(await asset.text(), /<svg\b/);
        assert.ok(existsSync(server.databasePath), "staged server must initialize its isolated SQLite file");
        assert.doesNotMatch(server.output(), /api\.waffo\.ai|pancake\.waffo\.ai/i);
      } finally {
        await stopServer(server.child);
      }
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});
