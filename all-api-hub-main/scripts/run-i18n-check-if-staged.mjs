import { execFileSync } from "node:child_process"

const gitCommand = process.platform === "win32" ? "git.exe" : "git"

const I18N_RELEVANT_PATH_PREFIXES = ["src/"]
const I18N_RELEVANT_PATHS = new Set([
  "i18next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/run-i18n-check-if-staged.mjs",
])

/**
 * Read the currently staged file paths for the pending commit.
 * @returns Normalized staged file paths using forward slashes.
 */
function getStagedFiles() {
  const output = execFileSync(
    gitCommand,
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  )

  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean)
}

/**
 * Determine whether any staged file should trigger the i18n extract guard.
 * @param stagedFiles Normalized staged file paths.
 * @returns True when the staged set touches i18n-relevant inputs.
 */
function shouldRunI18nCheck(stagedFiles) {
  return stagedFiles.some((file) => {
    if (I18N_RELEVANT_PATHS.has(file)) {
      return true
    }

    return I18N_RELEVANT_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))
  })
}

/**
 * Run pnpm subcommands in a cross-platform way.
 *
 * Prefer `npm_execpath` when available because this script itself runs under
 * `pnpm run ...`, which already exposes the resolved pnpm CLI entrypoint.
 * Falling back to a shell invocation keeps the script usable outside that context.
 * @param args pnpm arguments excluding the `pnpm` executable itself.
 */
function runPnpm(args) {
  if (
    typeof process.env.npm_execpath === "string" &&
    process.env.npm_execpath
  ) {
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      stdio: "inherit",
    })
    return
  }

  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], {
      stdio: "inherit",
    })
    return
  }

  execFileSync("pnpm", args, {
    stdio: "inherit",
  })
}

const stagedFiles = getStagedFiles()

if (stagedFiles.length === 0) {
  console.log("⏭️  No staged files detected, skipping i18n check.")
  process.exit(0)
}

if (!shouldRunI18nCheck(stagedFiles)) {
  console.log(
    "⏭️  No i18n-relevant staged files detected, skipping i18n check.",
  )
  process.exit(0)
}

console.log("🌐 Running staged i18n extract check...")
runPnpm(["run", "i18n:extract:ci"])

console.log("🌐 Running staged i18n status check...")
runPnpm(["run", "i18n:status"])
