# claude-code-backup

> Never lose your Claude Code memory, settings, or project instructions again.

[![npm version](https://img.shields.io/npm/v/claude-code-backup.svg)](https://www.npmjs.com/package/claude-code-backup)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://www.apple.com/macos/)

`claude-code-backup` is a CLI tool that watches your Claude Code data directories and automatically syncs every change to a **private GitHub repository**. Set it up once — it runs silently in the background on every login, committing your memory files, settings, keybindings, custom commands, and project `CLAUDE.md` files to Git so you always have a versioned, restorable history.

---

## Why This Exists

Claude Code stores your entire working relationship with Claude on disk:

| Data | Location | What you lose without it |
|---|---|---|
| **Memory files** | `~/.claude/projects/*/memory/*.md` | Everything Claude knows about you and your projects — rebuilt from scratch |
| **Settings** | `~/.claude/settings.json` | All configuration, permissions, hooks |
| **Keybindings** | `~/.claude/keybindings.json` | Custom keyboard shortcuts |
| **Custom commands** | `~/.claude/commands/` | Every slash command and skill you've built |
| **CLAUDE.md files** | `<project>/CLAUDE.md` | Project-specific instructions Claude reads every session |

None of this is synced by Anthropic. A new machine, an accidental `rm -rf ~/.claude`, or a corrupted filesystem means starting over. `claude-code-backup` fixes that.

---

## Features

- **Real-time sync** — [chokidar](https://github.com/paulmillr/chokidar) file watcher detects changes within milliseconds and pushes to GitHub after a configurable debounce
- **Full version history** — every backup is a Git commit, so you can restore any point in time
- **Project CLAUDE.md support** — backs up per-project `CLAUDE.md` files without touching your source code
- **Safe restore** — always creates a local snapshot of your current state before overwriting anything
- **macOS auto-start** — installs as a launchd service so the watcher starts on every login with `KeepAlive`
- **Zero credential setup** — auto-detects SSH keys, GitHub CLI, or macOS Keychain; only asks for a token if nothing is found
- **Interactive setup** — guided wizard creates the GitHub repo for you if it doesn't exist
- **Configurable** — choose which dirs to watch, which files to exclude, debounce timing
- **Private by default** — your backup repo is always created as private

---

## Requirements

- **Node.js** 18 or later
- **macOS** (launchd service feature; file watching works on Linux/Windows too)
- **GitHub account** — no token setup needed if you already use git with GitHub

---

## Installation

```bash
npm install -g claude-code-backup
```

Installs the `claude-code-backup` command globally.

---

## Quick Start

```bash
# 1. Run the setup wizard
claude-code-backup init

# 2. Do your first manual backup
claude-code-backup push

# 3. Install the background service (auto-syncs on every login)
claude-code-backup service install

# 4. Check everything is working
claude-code-backup status
```

That's it. From this point the watcher runs silently in the background and pushes every change to your private GitHub repo.

---

## Setup Wizard (`init`)

```
$ claude-code-backup init

Claude Backup — Setup Wizard

Step 1 of 4 — GitHub Authentication

  Checking for existing GitHub credentials...
  ✔ Found: git credential helper (osxkeychain) — using system credentials.
  No GitHub token needed — git will authenticate automatically.

Step 2 of 4 — Repository & Branch
? GitHub repo name (e.g. yourname/claude-code-backup): yourname/claude-code-backup
? Branch name: main

Step 3 of 4 — Watched Directories & Filters
? Directories to watch: /Users/you/.claude
? Files to exclude: settings.local.json, *.log, .DS_Store
? Debounce delay in ms: 2000

Step 4 of 4 — Project CLAUDE.md Files
? Project root directories with CLAUDE.md (blank to skip): /Users/you/projects/my-app

✔ Config saved
✔ Created: github.com/yourname/claude-code-backup
✔ Repo cloned
✔ GitHub setup complete
```

**Step 1 detects your existing credentials automatically** — in order:

| Priority | Method | Detected when |
|---|---|---|
| 1 | SSH key | `~/.ssh/id_*.pub` exists |
| 2 | GitHub CLI | `gh auth status` shows logged in |
| 3 | macOS Keychain / system helper | `git credential fill` returns a token |
| 4 | Personal Access Token (fallback) | none of the above found |

If none are found, the wizard shows instructions for creating a PAT and prompts you to paste it.

The wizard:
- Creates the GitHub repo as **private** if it doesn't exist
- Clones it locally to `~/.config/claude-code-backup/repo/`
- Writes a detailed `README.md` into your backup repo documenting the structure and restore process

---

## Command Reference

### `claude-code-backup init`

Interactive setup wizard. Run once to configure, or again at any time to update settings.

```bash
claude-code-backup init
```

---

### `claude-code-backup push`

Manually push a backup to GitHub right now.

```bash
claude-code-backup push                          # auto commit message: "backup: <ISO timestamp>"
claude-code-backup push -m "before OS upgrade"  # custom commit message
```

What it does:
1. Walks all watched directories, applies exclude filters
2. Copies every file into the local repo clone under a labelled directory
3. Collects `CLAUDE.md` from each configured project root
4. Writes `backup-manifest.json` (maps labels back to source paths for restore)
5. Regenerates the backup repo `README.md`
6. `git add -A` → `git commit` → `git push`
7. Skips the push if nothing has changed

---

### `claude-code-backup pull`

Restore files from your GitHub backup.

```bash
claude-code-backup pull                # restore the latest backup
claude-code-backup pull --history      # browse commits, pick a specific version
claude-code-backup pull --dry-run      # preview what would change — no files written
```

**Safety:** before touching any file, `pull` creates a timestamped snapshot of your current state at `~/.config/claude-code-backup/pre-restore-<timestamp>/`. You can always manually recover from there.

Restore works on:
- **Same machine** — recover from accidental deletion
- **New machine** — run `init` with the same repo, then `pull`
- **Historical version** — use `--history` to pick any commit

---

### `claude-code-backup watch`

Start the real-time file watcher. Normally this runs via the launchd service — use this command to run it manually in the foreground.

```bash
claude-code-backup watch                   # file watcher (recommended)
claude-code-backup watch --interval 5      # poll every 5 minutes instead
```

The watcher:
- Detects changes using [chokidar](https://github.com/paulmillr/chokidar)
- Waits for the debounce period (default 2 s) after the last change before pushing
- Ignores `.git` directories to avoid feedback loops
- Handles `SIGTERM`/`SIGINT` gracefully

---

### `claude-code-backup status`

Show the current state of your backup.

```
$ claude-code-backup status

Claude Backup Status

Watched dirs:
  /Users/you/.claude
Files tracked: 42

Project CLAUDE.md dirs:
  /Users/you/projects/my-app
CLAUDE.md files: 1

GitHub: yourname/claude-code-backup  [main]
Last backup:  2026-05-18 10:34:22
Commit:       a3f9c1d  backup: 2026-05-18T10:34:22.000Z
Sync status:  Up to date

Auto-sync service: running (PID 4821)
```

---

### `claude-code-backup service <action>`

Manage the macOS launchd background service.

```bash
claude-code-backup service install     # write plist, load service, start immediately
claude-code-backup service uninstall   # stop service, remove plist
claude-code-backup service status      # check if running, show PID
claude-code-backup service logs        # tail the watcher log in real-time
```

The service plist is installed at:

```
~/Library/LaunchAgents/com.claude-code-backup.watch.plist
```

Key behaviour:
- `RunAtLoad: true` — starts immediately when installed, and on every login
- `KeepAlive: true` — launchd restarts the watcher automatically if it crashes
- `ThrottleInterval: 10` — prevents restart storms
- Logs go to `~/.config/claude-code-backup/watch.log`
- Errors go to `~/.config/claude-code-backup/watch.error.log`

---

### `claude-code-backup config <action>`

View or modify configuration without re-running `init`.

```bash
claude-code-backup config show                             # print config (PAT masked)
claude-code-backup config set auto_sync.debounce_ms 3000   # change a value
claude-code-backup config add-dir <path>                   # fully mirror an extra directory
claude-code-backup config remove-dir <path>
claude-code-backup config add-project <path>               # back up only CLAUDE.md from a project root
claude-code-backup config remove-project <path>
```

---

## CLAUDE.md Backup

Claude Code lets you put a `CLAUDE.md` file at any project root. Claude reads it at the start of every session — it's where you define project-specific context, conventions, and rules.

`claude-code-backup` backs these up separately from your source code: only the `CLAUDE.md` file is collected, not the rest of the project directory.

```bash
# Add a project during init (Step 4)
# Or add it later:
claude-code-backup config add-project /Users/you/projects/my-app
```

In the backup repo, it appears as:

```
claude_md_Users_you_projects_my-app/
  CLAUDE.md
```

On restore, it goes straight back to `/Users/you/projects/my-app/CLAUDE.md`.

---

## Backup Repo Structure

Your private GitHub backup repo looks like this:

```
/
├── README.md                             ← auto-generated usage guide
├── backup-manifest.json                  ← label → source path mapping
│
├── Users_<name>_.claude/                 ← full mirror of ~/.claude/
│   ├── settings.json
│   ├── keybindings.json
│   ├── projects/
│   │   └── <hash>/
│   │       └── memory/
│   │           ├── MEMORY.md
│   │           └── *.md
│   └── commands/
│       └── *.md
│
└── claude_md_Users_<name>_projects_myapp/
    └── CLAUDE.md
```

Every push is a Git commit — you get full history, diffs, and can restore any point in time.

---

## Configuration Reference

Config file: `~/.config/claude-code-backup/config.json` (chmod 600)

| Key | Type | Default | Description |
|---|---|---|---|
| `github.repo` | string | — | GitHub repo in `owner/name` format |
| `github.branch` | string | `"main"` | Branch to push to |
| `auth_method` | string | auto-detected | `"system"` · `"ssh"` · `"pat"` |
| `github.pat` | string | — | Personal Access Token — only stored when `auth_method` is `"pat"` |
| `watched_dirs` | string[] | `["~/.claude"]` | Directories to fully mirror |
| `claude_md_dirs` | string[] | `[]` | Project roots — only `CLAUDE.md` backed up |
| `exclude` | string[] | see below | Filenames/globs to skip |
| `auto_sync.debounce_ms` | number | `2000` | ms to wait after last change before pushing |

Default excludes: `settings.local.json`, `*.log`, `.DS_Store`

**Auth methods:**
- `system` — git uses your system credential helper (macOS Keychain, gh CLI, GNOME Keyring). No token stored in config.
- `ssh` — git uses SSH keys. No token stored in config.
- `pat` — a Personal Access Token is embedded in git operations and stored locally in config (chmod 600).

Local repo clone: `~/.config/claude-code-backup/repo/`

---

## Restore Guide

### After accidental deletion (same machine)

```bash
claude-code-backup pull
```

### Setting up a new machine

```bash
npm install -g claude-code-backup
claude-code-backup init      # use the same repo name; auth is auto-detected from your credentials
claude-code-backup pull
claude-code-backup service install
```

### Restoring a specific historical version

```bash
claude-code-backup pull --history
```

Shows a list of all commits — pick the one you want by timestamp and message.

### Undoing a restore

Every `pull` creates a safety snapshot first:

```bash
ls ~/.config/claude-code-backup/pre-restore-*/
# Copy what you need back manually
```

---

## Troubleshooting

**"Not configured. Run: claude-code-backup init"**
Config file is missing or incomplete. Re-run `claude-code-backup init`.

**Push fails with 401 or authentication error**

Check which auth method is configured:
```bash
claude-code-backup config show   # look at "auth_method"
```

- `system` — your system credentials for `github.com` may have expired. Re-authenticate via your credential helper (e.g. `gh auth login` or sign in via macOS Keychain) then try again.
- `pat` — your Personal Access Token may have expired. Generate a new one at [github.com/settings/tokens](https://github.com/settings/tokens) and update:
  ```bash
  claude-code-backup config set github.pat <new-token>
  claude-code-backup service install   # restart the watcher
  ```
- Still failing? Re-run `claude-code-backup init` — it will re-detect your credentials and reconfigure.

**Service shows "loaded but not running"**
```bash
claude-code-backup service logs
cat ~/.config/claude-code-backup/watch.error.log
claude-code-backup service install   # reinstall to reset
```

**Changes not being detected**
Confirm the directory is watched:
```bash
claude-code-backup config show
claude-code-backup config add-dir /missing/path
```

**Want to watch a project directory without backing up all source code**
Use `add-project` instead of `add-dir` — it only collects the `CLAUDE.md` file:
```bash
claude-code-backup config add-project /path/to/project
```

---

## How It Works

```
~/.claude/ (file changes)
      │
      ▼
  chokidar watcher
      │  debounce 2s
      ▼
  collectFiles()
  ├─ walk watched_dirs recursively
  └─ grab CLAUDE.md from claude_md_dirs
      │
      ▼
  copy to ~/.config/claude-code-backup/repo/
  write backup-manifest.json
  write README.md
      │
      ▼
  git add -A → git commit → git push
      │
      ▼
  github.com/you/claude-code-backup (private)
```

---

## Contributing

Contributions are welcome. Please open an issue first for any significant change.

```bash
git clone https://github.com/mafzal9/claude-code-backup.git
cd claude-code-backup
npm install
node bin/claude-code-backup.js --help
```

Ideas for future contributions:
- Google Drive backend
- Linux systemd service support
- Windows Task Scheduler support
- Encryption at rest before pushing
- Selective restore (pick individual files)
- Diff view before restore

---

## License

MIT — see [LICENSE](LICENSE)

Copyright © 2026 Muhammad Afzal

---

## Author

**Muhammad Afzal**

[![X / Twitter](https://img.shields.io/badge/X-%40AfzalBuilds-black?logo=x&logoColor=white)](https://x.com/AfzalBuilds)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-mafzal9-0077B5?logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mafzal9/)
[![YouTube](https://img.shields.io/badge/YouTube-%40AfzalBuilds-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@AfzalBuilds)
[![GitHub](https://img.shields.io/badge/GitHub-mafzal9-181717?logo=github&logoColor=white)](https://github.com/mafzal9/)

---

*Built for the Claude Code community. If this saved your memory files, give it a star ⭐*
