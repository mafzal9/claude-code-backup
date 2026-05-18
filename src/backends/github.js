import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import simpleGit from 'simple-git';
import { Octokit } from '@octokit/rest';
import { REPO_DIR } from '../core/config.js';
import { collectFiles, buildManifest } from '../core/collector.js';
import { log, spinner } from '../utils/logger.js';

const execAsync = promisify(exec);

function remoteUrl(config) {
  if (config.auth_method === 'ssh') {
    return `git@github.com:${config.github.repo}.git`;
  }
  // Explicit PAT auth: embed as x-access-token:<PAT> (correct GitHub OAuth format,
  // no credential prompt needed so it works in non-TTY/background service contexts)
  if (config.auth_method === 'pat' && config.github?.pat) {
    return `https://x-access-token:${config.github.pat}@github.com/${config.github.repo}.git`;
  }
  // System auth or legacy config: bare URL, credential helper (osxkeychain/gh) handles it
  return `https://github.com/${config.github.repo}.git`;
}

async function getApiToken(config) {
  if (config.github?.pat) return config.github.pat;

  // Try git credential helper (osxkeychain, gh, gnome-keyring, etc.)
  try {
    const { stdout } = await execAsync(
      'printf "protocol=https\\nhost=github.com\\n" | git credential fill'
    );
    const match = stdout.match(/^password=(.+)$/m);
    if (match?.[1]?.trim()) return match[1].trim();
  } catch {}

  // Try gh CLI
  try {
    const { stdout } = await execAsync('gh auth token 2>/dev/null');
    if (stdout.trim()) return stdout.trim();
  } catch {}

  return null;
}

function repoGit() {
  return simpleGit(REPO_DIR);
}

async function configureGit(g) {
  await g.addConfig('user.email', 'claude-code-backup@local', false, 'local');
  await g.addConfig('user.name', 'claude-code-backup', false, 'local');
}

async function syncRemote(g, config) {
  const remotes = await g.getRemotes();
  if (remotes.find(r => r.name === 'origin')) {
    await g.remote(['set-url', 'origin', remoteUrl(config)]);
  } else {
    await g.addRemote('origin', remoteUrl(config));
  }
}

function buildReadme(config) {
  const now = new Date().toISOString().slice(0, 10);
  const watchedList = config.watched_dirs.map(d => `- \`${d}\``).join('\n');
  const excludeList = config.exclude.map(e => `- \`${e}\``).join('\n');
  const claudeMdDirs = config.claude_md_dirs || [];
  const claudeMdList = claudeMdDirs.length
    ? claudeMdDirs.map(d => `- \`${d}/CLAUDE.md\``).join('\n')
    : '_No project CLAUDE.md dirs configured yet._\n\nAdd one with: `claude-code-backup config add-project /path/to/project`';

  return `# Claude Code Backup

> Auto-synced by [claude-code-backup](https://www.npmjs.com/package/claude-code-backup) — a CLI tool that watches your Claude Code data directories and commits every change to this private repo.

**Repo:** \`${config.github.repo}\` · **Branch:** \`${config.github.branch}\` · **Last setup:** ${now}

---

## What Is This Repo?

This is a private, automated backup of all your [Claude Code](https://claude.ai/code) data — including:

| What | Why it matters |
|---|---|
| **Memory files** | Claude's persistent knowledge about you, your projects, and your preferences |
| **Settings** | Global and project-level Claude Code configuration |
| **Keybindings** | Your custom keyboard shortcuts |
| **Custom commands** | Slash commands and skills you've defined |
| **Project \`CLAUDE.md\` files** | Per-project instructions that Claude reads at the start of every session |

Without a backup, all of this is lost if you get a new machine, accidentally delete \`~/.claude/\`, or need to set up Claude Code on a second device.

---

## Watched Directories

The following directories are fully mirrored here (recursive):

${watchedList}

Files excluded from backup:

${excludeList}

## Project CLAUDE.md Files

Only the \`CLAUDE.md\` file is collected from each of these project roots
(the rest of the project source code is not touched):

${claudeMdList}

Add or remove projects at any time:
\`\`\`bash
claude-code-backup config add-project /path/to/project
claude-code-backup config remove-project /path/to/project
\`\`\`

---

## Repo Structure

\`\`\`
/
├── README.md                        ← this file (regenerated on every push)
├── backup-manifest.json             ← maps each folder label → original source path
│
├── Users_<name>_.claude/            ← full mirror of ~/.claude/
│   ├── settings.json                ← global Claude Code settings
│   ├── keybindings.json             ← custom keyboard shortcuts
│   ├── projects/                    ← per-project memory and settings
│   │   └── <project-hash>/
│   │       └── memory/
│   │           ├── MEMORY.md        ← memory index for that project
│   │           └── *.md             ← individual memory files
│   └── commands/                    ← custom slash commands / skills
│       └── *.md
│
├── claude_md_Users_<name>_myapp/    ← CLAUDE.md from a project root
│   └── CLAUDE.md
│
└── claude_md_Users_<name>_other/    ← CLAUDE.md from another project
    └── CLAUDE.md
\`\`\`

**Directory labels** are created by replacing \`/\` with \`_\` in the source path.
Labels starting with \`claude_md_\` are project CLAUDE.md entries — only that single file
is stored, not the whole project. \`backup-manifest.json\` records the original path for
every label so restore always knows exactly where to copy files back.

---

## Claude Code Memory — Quick Primer

Claude Code has a file-based memory system stored under \`~/.claude/projects/<hash>/memory/\`:

- **\`MEMORY.md\`** — the index file, loaded into every conversation with that project
- **\`*.md\` files** — individual memory entries (user profile, feedback, project context, references)

Memory entries have types:
| Type | Contains |
|---|---|
| \`user\` | Who you are, your role, expertise level |
| \`feedback\` | How Claude should behave — what to avoid, what to repeat |
| \`project\` | Active work, goals, deadlines, architectural decisions |
| \`reference\` | Where to find things — Linear projects, Grafana dashboards, Slack channels |

These files are the most valuable thing to back up because they accumulate over months and are impossible to recreate from scratch.

---

## Installation

\`\`\`bash
npm install -g claude-code-backup
\`\`\`

Requires Node.js 18 or later.

---

## Command Reference

### \`claude-code-backup init\`

Interactive setup wizard. Run this once (or again to reconfigure).

\`\`\`
$ claude-code-backup init

Step 1 of 3 — GitHub Personal Access Token
  Create your token here: https://github.com/settings/tokens/new
  Required scope: repo (top-level checkbox)

? Paste your GitHub PAT: ****

Step 2 of 3 — Repository & Branch
? GitHub repo name: yourname/claude-code-backup
? Branch name: main

Step 3 of 3 — Watched Directories & Filters
? Directories to watch: ~/.claude
? Files to exclude: settings.local.json, *.log, .DS_Store
? Debounce delay in ms: 2000
\`\`\`

What it does:
- Saves config to \`~/.config/claude-code-backup/config.json\` (chmod 600)
- Creates this GitHub repo as private if it doesn't exist
- Clones the repo locally to \`~/.config/claude-code-backup/repo/\`
- Writes this README into the repo

---

### \`claude-code-backup push\`

Manually push a backup right now.

\`\`\`bash
claude-code-backup push                        # auto commit message: "backup: <ISO timestamp>"
claude-code-backup push -m "before upgrade"   # custom commit message
\`\`\`

What it does:
1. Walks all watched directories, applies exclude filters
2. Copies every file into the local repo clone under its label directory
3. Writes \`backup-manifest.json\` with the source-path mapping
4. \`git add -A\` → \`git commit\` → \`git push\`
5. Skips the push if nothing changed

---

### \`claude-code-backup pull\`

Restore files from this repo back to their original locations.

\`\`\`bash
claude-code-backup pull                  # restore the latest backup
claude-code-backup pull --history        # browse commits, pick a specific version
claude-code-backup pull --dry-run        # preview what would be restored — no files written
\`\`\`

**Safety:** before writing anything, \`pull\` creates a timestamped snapshot of your current state at \`~/.config/claude-code-backup/pre-restore-<timestamp>/\` so you can always undo.

Restore flow:
1. \`git fetch origin\` to get latest from GitHub
2. If \`--history\`: show commit list → you pick one
3. Checkout the selected commit's files into the local clone
4. Read \`backup-manifest.json\` to determine target paths
5. Ask for confirmation, show a preview of affected files
6. Create safety snapshot, then copy files to their source locations

---

### \`claude-code-backup watch\`

Start the real-time file watcher. Detects changes in watched directories and auto-pushes to GitHub.

\`\`\`bash
claude-code-backup watch                    # real-time via chokidar (recommended)
claude-code-backup watch --interval 5       # poll every 5 minutes instead
\`\`\`

The watcher:
- Uses [chokidar](https://github.com/paulmillr/chokidar) for efficient, cross-platform file watching
- Debounces rapid changes (default: 2000 ms) so a burst of saves becomes one commit
- Ignores \`.git\` subdirectories to avoid feedback loops
- Handles \`SIGTERM\` and \`SIGINT\` gracefully (important for launchd)
- Logs every sync with a timestamp

In normal use you don't run this directly — the launchd service runs it for you in the background.

---

### \`claude-code-backup status\`

Show a summary of the current state.

\`\`\`
$ claude-code-backup status

Claude Backup Status

Watched dirs:
  /Users/you/.claude

Files tracked: 42

GitHub: yourname/claude-code-backup  [main]
Last backup:  2026-05-18 10:34:22
Commit:       a3f9c1d  backup: 2026-05-18T10:34:22.000Z
Sync status:  Up to date

Auto-sync service: running (PID 1234)
\`\`\`

---

### \`claude-code-backup service <action>\`

Manage the macOS launchd background service that runs the file watcher automatically on every login.

\`\`\`bash
claude-code-backup service install     # write plist + load service now
claude-code-backup service uninstall   # stop service + remove plist
claude-code-backup service status      # check if running, show PID
claude-code-backup service logs        # tail the watcher log in real-time
\`\`\`

The service plist is installed at:
\`\`\`
~/Library/LaunchAgents/com.claude-code-backup.watch.plist
\`\`\`

Key plist settings:
- \`RunAtLoad: true\` — starts when the service is loaded (immediately on install)
- \`KeepAlive: true\` — launchd restarts the watcher if it ever crashes
- \`ThrottleInterval: 10\` — prevents rapid restart loops if something goes wrong
- Stdout → \`~/.config/claude-code-backup/watch.log\`
- Stderr → \`~/.config/claude-code-backup/watch.error.log\`

---

### \`claude-code-backup config <action>\`

View or modify configuration without re-running \`init\`.

\`\`\`bash
claude-code-backup config show                            # print current config (PAT masked)
claude-code-backup config set auto_sync.debounce_ms 3000  # change a value
claude-code-backup config add-dir /path/to/project        # watch an extra directory
claude-code-backup config remove-dir /path/to/project     # stop watching a directory
\`\`\`

Nested keys use dot notation. Values are auto-cast (numbers, booleans).

---

## Auto-Sync Setup (Recommended)

After running \`init\` and \`push\`, install the background service:

\`\`\`bash
claude-code-backup service install
\`\`\`

From this point on:
- The watcher starts automatically every time you log in to macOS
- Any change to a watched directory is committed and pushed to GitHub within ~2 seconds
- If the watcher crashes, launchd restarts it automatically
- You never have to think about backups again

To verify it's working:

\`\`\`bash
claude-code-backup status                # should show "running (PID ...)"
claude-code-backup service logs          # live log of every sync
\`\`\`

---

## Restore Guide

### Restore to the same machine (after accidental deletion)

\`\`\`bash
claude-code-backup pull
\`\`\`

Confirm the preview, and your files are back.

### Restore to a new machine

\`\`\`bash
# 1. Install Node.js (18+) and claude-code-backup
npm install -g claude-code-backup

# 2. Run init with the same GitHub repo
claude-code-backup init
#    → Same repo name (yourname/claude-code-backup)
#    → New GitHub PAT (generate a new one)

# 3. Pull the latest backup
claude-code-backup pull

# 4. Install the background service on the new machine
claude-code-backup service install
\`\`\`

### Restore a specific historical version

\`\`\`bash
claude-code-backup pull --history
\`\`\`

This shows a list of all commits in this repo. Select the one you want — the timestamp and commit message help identify when each backup was taken.

---

## Configuration Reference

Config file location: \`~/.config/claude-code-backup/config.json\`

| Key | Type | Default | Description |
|---|---|---|---|
| \`backend\` | string | \`"github"\` | Storage backend (currently only \`github\`) |
| \`github.repo\` | string | — | GitHub repo in \`owner/name\` format |
| \`github.branch\` | string | \`"main"\` | Branch to push to |
| \`github.pat\` | string | — | Personal Access Token (stored chmod 600) |
| \`watched_dirs\` | string[] | \`["~/.claude"]\` | Directories to fully mirror |
| \`claude_md_dirs\` | string[] | \`[]\` | Project roots — only \`CLAUDE.md\` is backed up from each |
| \`exclude\` | string[] | see below | Filenames/globs to skip |
| \`auto_sync.debounce_ms\` | number | \`2000\` | ms to wait after last change before pushing |

Default excludes: \`settings.local.json\`, \`*.log\`, \`.DS_Store\`

The local repo clone lives at: \`~/.config/claude-code-backup/repo/\`

---

## Security Notes

- This repo is **private** — only you and anyone you explicitly invite can see it
- Your GitHub PAT is stored locally at \`~/.config/claude-code-backup/config.json\` with \`chmod 600\` (owner-read only)
- The PAT is never committed to this repo
- \`settings.local.json\` is excluded by default because it may contain machine-specific or sensitive values
- If you ever rotate your PAT, run \`claude-code-backup config set github.pat <new-token>\` then \`claude-code-backup service install\` to restart the watcher with the new token

---

## Troubleshooting

**"Not configured. Run: claude-code-backup init"**
The config file is missing or incomplete. Re-run \`claude-code-backup init\`.

**Push fails with authentication error**
Your PAT may have expired or been revoked. Generate a new one at
https://github.com/settings/tokens/new and run:
\`\`\`bash
claude-code-backup config set github.pat <new-token>
\`\`\`

**Service shows "loaded but not running"**
Check the error log:
\`\`\`bash
claude-code-backup service logs
cat ~/.config/claude-code-backup/watch.error.log
\`\`\`
Then reinstall the service: \`claude-code-backup service install\`

**Files not being detected by the watcher**
Confirm the directory is in your watch list:
\`\`\`bash
claude-code-backup config show
claude-code-backup config add-dir /path/to/missing/dir
\`\`\`

**Restore wrote wrong files / I want to undo**
Every restore creates a safety snapshot before touching anything:
\`\`\`bash
ls ~/.config/claude-code-backup/pre-restore-*/
\`\`\`
Copy the files you need back from there manually.

---

*This README is auto-generated by \`claude-code-backup init\` and reflects the configuration at setup time.*
`;
}

export async function ensureRepo(config) {
  const [owner, repo] = config.github.repo.split('/');
  const token = await getApiToken(config);

  if (token) {
    const octokit = new Octokit({ auth: token });
    let repoExists = false;
    try {
      await octokit.repos.get({ owner, repo });
      repoExists = true;
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    if (!repoExists) {
      const spin = spinner('Creating private GitHub repo...').start();
      await octokit.repos.createForAuthenticatedUser({
        name: repo,
        private: true,
        description: 'Claude Code backup — memory, settings, commands',
        auto_init: true,
      });
      spin.succeed(`Created: github.com/${config.github.repo}`);
    } else {
      log.info(`Repo exists: github.com/${config.github.repo}`);
    }
  } else {
    log.warn('No GitHub API token found — skipping repo creation check.');
    log.dim('  Make sure the repo exists at github.com and your system git credentials are set up.');
  }

  // Clone locally if not already done
  if (!existsSync(REPO_DIR)) {
    mkdirSync(REPO_DIR, { recursive: true });
    const spin = spinner('Cloning repo...').start();
    await simpleGit().clone(remoteUrl(config), REPO_DIR);
    spin.succeed('Repo cloned to: ' + REPO_DIR);
  } else {
    log.info('Local repo clone already exists');
  }

  // Seed the README so it exists in the clone from day one
  writeFileSync(join(REPO_DIR, 'README.md'), buildReadme(config), 'utf8');
}

function localTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function push(config, commitMessage) {
  if (!existsSync(REPO_DIR)) {
    log.error('Repo not set up. Run: claude-code-backup init');
    process.exit(1);
  }

  const files = collectFiles(config);
  if (files.length === 0) {
    log.warn('No files found — check your watched_dirs in config');
    return 0;
  }

  const spin = spinner(`Staging ${files.length} files...`).start();

  // Copy all watched files into the repo mirror
  for (const { src, dest } of files) {
    const target = join(REPO_DIR, dest);
    mkdirSync(dirname(target), { recursive: true });
    try {
      copyFileSync(src, target);
    } catch {
      // Skip unreadable files silently
    }
  }

  // Write the manifest so pull knows where to restore each label dir
  writeFileSync(
    join(REPO_DIR, 'backup-manifest.json'),
    JSON.stringify(buildManifest(config), null, 2),
    'utf8'
  );

  // Always regenerate README so it stays current
  writeFileSync(join(REPO_DIR, 'README.md'), buildReadme(config), 'utf8');

  const g = repoGit();
  await configureGit(g);
  await syncRemote(g, config);

  const status = await g.status();
  if (status.files.length === 0) {
    spin.succeed('Everything up to date — nothing to push');
    return 0;
  }

  spin.text = `Committing ${status.files.length} change(s)...`;
  await g.add('-A');
  await g.commit(commitMessage || `backup: ${localTimestamp()}`);

  spin.text = 'Pushing to GitHub...';
  await g.raw(['push', '-u', 'origin', config.github.branch]);

  spin.succeed(`Pushed ${status.files.length} file(s) → github.com/${config.github.repo}`);
  return status.files.length;
}

export async function getStatus(config) {
  if (!existsSync(REPO_DIR)) return null;
  const g = repoGit();
  try {
    const logResult = await g.log(['--max-count=1']);
    const status = await g.status();
    return {
      lastCommit: logResult.latest,
      pending: status.files.length,
    };
  } catch {
    return null;
  }
}

export async function getHistory(config, limit = 15) {
  if (!existsSync(REPO_DIR)) return [];
  const g = repoGit();
  await syncRemote(g, config);
  await g.fetch('origin');
  const logResult = await g.log({ maxCount: limit });
  return logResult.all;
}

export async function fetchForRestore(config, ref) {
  if (!existsSync(REPO_DIR)) {
    log.error('Repo not set up. Run: claude-code-backup init');
    process.exit(1);
  }

  const g = repoGit();
  await configureGit(g);
  await syncRemote(g, config);

  const spin = spinner('Fetching from GitHub...').start();
  await g.fetch('origin');
  spin.stop();

  // Checkout the target ref files into the working tree
  const targetRef = ref || `origin/${config.github.branch}`;
  await g.checkout([targetRef, '--', '.']);

  // Read the manifest that was just checked out
  const manifestPath = join(REPO_DIR, 'backup-manifest.json');
  if (!existsSync(manifestPath)) return null;

  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}
