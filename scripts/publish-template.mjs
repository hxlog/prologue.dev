import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WORKTREE_DIR = path.join(ROOT, ".tmp", "template-worktree");
const TEMPLATE_ROOT = path.join(ROOT, "template");
const README_TEMPLATE = path.join(ROOT, "README.template.md");
const MERMAID_MANIFEST_PATH = "src/lib/feed/mermaid-manifest.json";
const TARGET_BRANCH = readArg("--branch") || "master";
const PUBLISH = hasFlag("--publish");
const ALLOW_DIRTY = hasFlag("--allow-dirty");

main();

function main() {
  assertGitRepo();
  ensureTemplateInputs();

  const dirty = git(["status", "--porcelain"], { cwd: ROOT }).stdout.trim();
  if (dirty && !ALLOW_DIRTY) {
    throw new Error(
      "Working tree is not clean. Commit/stash first, or rerun with --allow-dirty."
    );
  }

  mkdirSync(path.dirname(WORKTREE_DIR), { recursive: true });
  safelyRemoveWorktree();

  git(["worktree", "add", "--force", "--detach", WORKTREE_DIR, "HEAD"], { cwd: ROOT });

  try {
    if (dirty && ALLOW_DIRTY) {
      overlayDirtyChanges(ROOT, WORKTREE_DIR);
    }

    applyStarterTemplate(WORKTREE_DIR);

    const mermaidManifest = path.join(WORKTREE_DIR, MERMAID_MANIFEST_PATH);
    if (existsSync(path.dirname(mermaidManifest))) {
      writeFileSync(mermaidManifest, "{}\n");
    }

    commitSnapshot(WORKTREE_DIR);

    if (PUBLISH) {
      pushTemplateRepo(WORKTREE_DIR);
      console.log(`Published template repo: hxlog/prologue-blog-template (${TARGET_BRANCH})`);
    } else {
      console.log(`Template snapshot prepared locally at ${WORKTREE_DIR}`);
      console.log("Use --publish (npm run publish) to push to hxlog/prologue-blog-template.");
    }
  } finally {
    safelyRemoveWorktree();
  }
}

function resolvePublishToken() {
  if (process.env.TEMPLATE_REPO_TOKEN) {
    return process.env.TEMPLATE_REPO_TOKEN.trim();
  }

  const ghCandidates = [
    "gh",
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "GitHub CLI", "gh.exe"),
    path.join(process.env["LocalAppData"] || "", "Programs", "GitHub CLI", "gh.exe"),
  ];

  for (const ghBin of ghCandidates) {
    const result = spawnSync(ghBin, ["auth", "token"], { cwd: ROOT, encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }

  throw new Error(
    "Missing TEMPLATE_REPO_TOKEN. Set the env var or run `gh auth login` so `gh auth token` works."
  );
}

function pushTemplateRepo(cwd) {
  const token = resolvePublishToken();
  const remoteUrl = "https://github.com/hxlog/prologue-blog-template.git";
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");

  // Bypass any inherited credential helper (e.g. actions/checkout GITHUB_TOKEN)
  // and authenticate with TEMPLATE_REPO_TOKEN via Basic auth (git HTTPS).
  const result = spawnSync(
    "git",
    [
      "-c",
      "credential.helper=",
      "-c",
      `http.extraHeader=AUTHORIZATION: basic ${basic}`,
      "push",
      "-f",
      remoteUrl,
      `HEAD:${TARGET_BRANCH}`,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }
  );

  if (result.status !== 0) {
    const detail = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
    throw new Error(
      `git push -f ${remoteUrl} HEAD:${TARGET_BRANCH} failed\n${detail}`.trim()
    );
  }
}

function applyStarterTemplate(worktreeRoot) {
  // Remove maintainer-only files from the published template repo.
  rmSync(path.join(worktreeRoot, "template"), { recursive: true, force: true });
  rmSync(path.join(worktreeRoot, "docs"), { recursive: true, force: true });
  rmSync(path.join(worktreeRoot, ".idea"), { recursive: true, force: true });
  rmSync(path.join(worktreeRoot, "README.template.md"), { force: true });
  rmSync(path.join(worktreeRoot, "scripts"), { recursive: true, force: true });
  // The template's npm scripts need the search-index generator; ship it.
  copyFile(
    path.join(ROOT, "scripts", "build-search-index.mjs"),
    path.join(worktreeRoot, "scripts", "build-search-index.mjs")
  );
  rmSync(path.join(worktreeRoot, ".contentlayer"), { recursive: true, force: true });
  rmSync(path.join(worktreeRoot, ".github", "workflows", "publish-starter.yml"), { force: true });
  rmSync(path.join(worktreeRoot, ".github", "workflows", "publish-template.yml"), { force: true });

  // Keep CI but only for master.
  const ciPath = path.join(worktreeRoot, ".github", "workflows", "ci.yml");
  if (existsSync(ciPath)) {
    writeFileSync(
      ciPath,
      `name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
`
    );
  }

  // Reset content layer.
  rmSync(path.join(worktreeRoot, "data", "content", "blog"), { recursive: true, force: true });
  rmSync(path.join(worktreeRoot, "data", "content", "pages"), { recursive: true, force: true });
  mkdirSync(path.join(worktreeRoot, "data", "content", "blog"), { recursive: true });
  mkdirSync(path.join(worktreeRoot, "data", "content", "pages"), { recursive: true });

  cpSync(
    path.join(TEMPLATE_ROOT, "data", "content", "blog"),
    path.join(worktreeRoot, "data", "content", "blog"),
    { recursive: true }
  );
  cpSync(
    path.join(TEMPLATE_ROOT, "data", "content", "pages"),
    path.join(worktreeRoot, "data", "content", "pages"),
    { recursive: true }
  );

  copyFile(
    path.join(TEMPLATE_ROOT, "data", "microblog.yaml"),
    path.join(worktreeRoot, "data", "microblog.yaml")
  );
  copyFile(
    path.join(TEMPLATE_ROOT, "data", "links.yaml"),
    path.join(worktreeRoot, "data", "links.yaml")
  );
  copyFile(
    path.join(TEMPLATE_ROOT, "data", "sitemetadata.js"),
    path.join(worktreeRoot, "data", "sitemetadata.js")
  );
  copyFile(
    path.join(TEMPLATE_ROOT, "data", "headerNavLinks.js"),
    path.join(worktreeRoot, "data", "headerNavLinks.js")
  );

  // Reset static assets for template.
  rmSync(path.join(worktreeRoot, "public", "static"), { recursive: true, force: true });
  mkdirSync(path.join(worktreeRoot, "public", "static"), { recursive: true });
  cpSync(path.join(TEMPLATE_ROOT, "public", "static"), path.join(worktreeRoot, "public", "static"), {
    recursive: true,
  });

  rmSync(path.join(worktreeRoot, "src", "public"), { recursive: true, force: true });

  copyFile(README_TEMPLATE, path.join(worktreeRoot, "README.md"));
  patchStarterPackageJson(worktreeRoot);
}

function patchStarterPackageJson(worktreeRoot) {
  const packageJsonPath = path.join(worktreeRoot, "package.json");
  if (!existsSync(packageJsonPath)) return;

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  packageJson.scripts = packageJson.scripts || {};
  delete packageJson.scripts.publish;
  delete packageJson.scripts["publish:dry"];
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function commitSnapshot(cwd) {
  // Branch from current HEAD (prologue master tip) so history stays linear like the old starter flow.
  git(["checkout", "-B", "template-publish"], { cwd });
  git(["add", "-A"], { cwd });
  const check = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd, encoding: "utf8" });
  if (check.status === 0) {
    console.log("No template changes to commit.");
    return;
  }

  git(["commit", "-m", "chore: sync template snapshot"], { cwd });
}

function overlayDirtyChanges(sourceRoot, worktreeRoot) {
  const modified = splitLines(git(["diff", "--name-only"], { cwd: sourceRoot }).stdout);
  const staged = splitLines(git(["diff", "--name-only", "--cached"], { cwd: sourceRoot }).stdout);
  const untracked = splitLines(
    git(["ls-files", "--others", "--exclude-standard"], { cwd: sourceRoot }).stdout
  );
  const deleted = new Set([
    ...splitLines(git(["diff", "--name-only", "--diff-filter=D"], { cwd: sourceRoot }).stdout),
    ...splitLines(git(["diff", "--name-only", "--cached", "--diff-filter=D"], { cwd: sourceRoot }).stdout),
  ]);

  const toCopy = new Set([...modified, ...staged, ...untracked]);
  for (const rel of toCopy) {
    if (!rel || deleted.has(rel) || rel.startsWith(".git")) continue;
    const source = path.join(sourceRoot, rel);
    const dest = path.join(worktreeRoot, rel);
    if (!existsSync(source)) continue;
    copyPath(source, dest);
  }

  for (const rel of deleted) {
    if (!rel || rel.startsWith(".git")) continue;
    rmSync(path.join(worktreeRoot, rel), { recursive: true, force: true });
  }
}

function copyPath(source, dest) {
  const sourceStat = statSync(source);
  if (sourceStat.isDirectory()) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(source, dest, { recursive: true });
    return;
  }

  mkdirSync(path.dirname(dest), { recursive: true });
  copyFile(source, dest);
}

function copyFile(source, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(source));
}

function safelyRemoveWorktree() {
  if (!existsSync(WORKTREE_DIR)) return;
  const removeResult = spawnSync("git", ["worktree", "remove", "--force", WORKTREE_DIR], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (removeResult.status !== 0) {
    try {
      rmSync(WORKTREE_DIR, { recursive: true, force: true });
    } catch {
      console.warn(`warning: unable to remove worktree directory: ${WORKTREE_DIR}`);
    }
  }
}

function ensureTemplateInputs() {
  const required = [
    TEMPLATE_ROOT,
    README_TEMPLATE,
    path.join(TEMPLATE_ROOT, "data", "content", "blog", "hello-prologue.md"),
    path.join(TEMPLATE_ROOT, "data", "content", "pages", "about.md"),
    path.join(TEMPLATE_ROOT, "data", "sitemetadata.js"),
    path.join(TEMPLATE_ROOT, "data", "headerNavLinks.js"),
    path.join(TEMPLATE_ROOT, "data", "links.yaml"),
    path.join(TEMPLATE_ROOT, "data", "microblog.yaml"),
  ];

  for (const target of required) {
    if (!existsSync(target)) {
      throw new Error(`Missing template input: ${target}`);
    }
  }
}

function assertGitRepo() {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes("true")) {
    throw new Error("This script must run inside a git repository.");
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`.trim()
    );
  }
  return result;
}
