const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const cache = require(path.join(
  process.env.RUNNER_TEMP,
  "chrome-cache-sdk",
  "node_modules",
  "@actions",
  "cache",
));

const profileDir = process.env.PROFILE_DIR;
const snapshotDir = path.join(process.env.RUNNER_TEMP, "chrome-config-snapshot");
const cacheBase = process.env.PROFILE_CACHE_BASE;
const stopFile = process.env.PROFILE_STOP_FILE;
const container = process.env.PROFILE_CONTAINER;
const intervalMs = Number(process.env.PROFILE_CACHE_INTERVAL_MS || 1800000);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function saveProfile(directory, suffix) {
  const key = `${cacheBase}-${suffix}-${Date.now()}`;
  await cache.saveCache([directory], key);
  console.log(`Chrome profile saved with cache key ${key}`);
}

async function saveSnapshot() {
  execFileSync("docker", ["pause", container], { stdio: "ignore" });
  try {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    fs.cpSync(profileDir, snapshotDir, { recursive: true });
  } finally {
    execFileSync("docker", ["unpause", container], { stdio: "ignore" });
  }
  await saveProfile(snapshotDir, "snapshot");
}

async function main() {
  let lastSnapshotAt = Date.now();

  while (!fs.existsSync(stopFile)) {
    await delay(5000);
    if (Date.now() - lastSnapshotAt < intervalMs) {
      continue;
    }

    try {
      await saveSnapshot();
    } catch (error) {
      console.error(`Chrome profile checkpoint failed: ${error.message}`);
    }
    lastSnapshotAt = Date.now();
  }

  try {
    execFileSync("docker", ["stop", container], { stdio: "ignore" });
  } catch (error) {
    console.error(`Could not stop Chrome container cleanly: ${error.message}`);
  }

  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.cpSync(profileDir, snapshotDir, { recursive: true });
  await saveProfile(snapshotDir, "final");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});