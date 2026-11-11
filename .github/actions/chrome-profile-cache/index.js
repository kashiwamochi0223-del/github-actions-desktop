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
const cookieMinIntervalMs = Number(process.env.PROFILE_COOKIE_MIN_INTERVAL_MS || 300000);
const cookieDebounceMs = Number(process.env.PROFILE_COOKIE_DEBOUNCE_MS || 30000);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cookieSignature() {
  if (!fs.existsSync(profileDir)) {
    return "";
  }

  const signatures = [];
  const scanDirectory = (directory, depth) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 2) {
        scanDirectory(entryPath, depth + 1);
      } else if (entry.isFile() && ["Cookies", "Cookies-wal"].includes(entry.name)) {
        const stat = fs.statSync(entryPath);
        signatures.push(`${entryPath}:${stat.mtimeMs}:${stat.size}`);
      }
    }
  };

  scanDirectory(profileDir, 0);
  return signatures.sort().join("|");
}

function copyProfileSnapshot() {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.cpSync(profileDir, snapshotDir, {
    recursive: true,
    filter: (source) => {
      const basename = path.basename(source);
      if (["SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"].includes(basename)) {
        return false;
      }
      const stat = fs.lstatSync(source);
      return stat.isDirectory() || stat.isFile() || stat.isSymbolicLink();
    },
  });
}

async function saveProfile(directory, suffix) {
  const key = `${cacheBase}-${suffix}-${Date.now()}`;
  await cache.saveCache([directory], key);
  console.log(`Chrome profile saved with cache key ${key}`);
}

async function saveSnapshot() {
  execFileSync("docker", ["pause", container], { stdio: "ignore" });
  try {
    copyProfileSnapshot();
  } finally {
    execFileSync("docker", ["unpause", container], { stdio: "ignore" });
  }
  await saveProfile(snapshotDir, "snapshot");
}

async function main() {
  let lastSnapshotAt = 0;
  let lastPeriodicSnapshotAt = Date.now();
  let lastCookieSignature = cookieSignature();
  let pendingCookieSnapshotAt = 0;

  while (!fs.existsSync(stopFile)) {
    await delay(5000);
    const now = Date.now();
    const currentCookieSignature = cookieSignature();
    if (currentCookieSignature !== lastCookieSignature) {
      lastCookieSignature = currentCookieSignature;
      pendingCookieSnapshotAt = now + cookieDebounceMs;
    }

    const cookieSnapshotDue = pendingCookieSnapshotAt && now >= pendingCookieSnapshotAt &&
      (!lastSnapshotAt || now - lastSnapshotAt >= cookieMinIntervalMs);
    const periodicSnapshotDue = now - lastPeriodicSnapshotAt >= intervalMs;
    if (!cookieSnapshotDue && !periodicSnapshotDue) {
      continue;
    }

    try {
      await saveSnapshot();
      lastSnapshotAt = Date.now();
      lastPeriodicSnapshotAt = lastSnapshotAt;
      pendingCookieSnapshotAt = 0;
    } catch (error) {
      console.error(`Chrome profile checkpoint failed: ${error.message}`);
      pendingCookieSnapshotAt = 0;
    }
  }

  try {
    execFileSync("docker", ["stop", container], { stdio: "ignore" });
  } catch (error) {
    console.error(`Could not stop Chrome container cleanly: ${error.message}`);
  }

  copyProfileSnapshot();
  await saveProfile(snapshotDir, "final");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});