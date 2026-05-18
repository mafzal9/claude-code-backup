import inquirer from 'inquirer';
import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { loadConfig, saveConfig } from '../core/config.js';
import { ensureRepo } from '../backends/github.js';
import { log } from '../utils/logger.js';

export async function runInit() {
  log.header('Claude Backup — Setup Wizard');

  const existing = loadConfig();

  // ── Step 1: GitHub PAT ───────────────────────────────────────────────────
  console.log(chalk.bold.underline('Step 1 of 4 — GitHub Personal Access Token') + '\n');
  console.log('claude-code-backup needs a PAT with ' + chalk.cyan('"repo"') + ' scope to create');
  console.log('and push to a private GitHub repository on your behalf.\n');
  console.log(chalk.bold('  Create your token here:'));
  console.log('  ' + chalk.underline.blue('https://github.com/settings/tokens/new') + '\n');
  console.log(chalk.dim('  Instructions:'));
  console.log(chalk.dim('  1. Note name → e.g. "claude-code-backup"'));
  console.log(chalk.dim('  2. Expiration → your preference (No expiration is fine)'));
  console.log(chalk.dim('  3. Scopes → tick  ') + chalk.cyan('repo') + chalk.dim('  (the top-level checkbox covers everything needed)'));
  console.log(chalk.dim('  4. Click "Generate token" and copy the value\n'));
  console.log(chalk.dim('  Fine-grained token alternative:'));
  console.log(chalk.dim('  ' + chalk.underline('https://github.com/settings/personal-access-tokens/new')));
  console.log(chalk.dim('  → Repository permissions: Contents (Read & Write), Metadata (Read)\n'));

  const { pat } = await inquirer.prompt([
    {
      type: 'password',
      name: 'pat',
      message: 'Paste your GitHub PAT:',
      default: existing?.github?.pat || '',
      validate: v => v.trim().length > 0 || 'PAT is required',
    },
  ]);

  // ── Step 2: Repo & branch ────────────────────────────────────────────────
  console.log('\n' + chalk.bold.underline('Step 2 of 4 — Repository & Branch') + '\n');
  console.log(chalk.dim('  The repo will be created as private if it does not exist yet.\n'));

  const { repo, branch } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repo',
      message: 'GitHub repo name (e.g. yourname/claude-code-backup):',
      default: existing?.github?.repo || '',
      validate: v =>
        /^[\w.-]+\/[\w.-]+$/.test(v.trim()) || 'Format must be owner/repo',
    },
    {
      type: 'input',
      name: 'branch',
      message: 'Branch name:',
      default: existing?.github?.branch || 'main',
    },
  ]);

  // ── Step 3: Watched dirs & filters ───────────────────────────────────────
  console.log('\n' + chalk.bold.underline('Step 3 of 4 — Watched Directories & Filters') + '\n');
  console.log(chalk.dim('  These directories are fully mirrored to GitHub on every change.\n'));

  const { watched_dirs, exclude, debounce_ms } = await inquirer.prompt([
    {
      type: 'input',
      name: 'watched_dirs',
      message: 'Directories to watch (comma-separated):',
      default: existing?.watched_dirs?.join(', ') || join(homedir(), '.claude'),
      filter: v => v.split(',').map(s => s.trim()).filter(Boolean),
    },
    {
      type: 'input',
      name: 'exclude',
      message: 'Files to exclude (comma-separated, * wildcards ok):',
      default:
        existing?.exclude?.join(', ') ||
        'settings.local.json, *.log, .DS_Store',
      filter: v => v.split(',').map(s => s.trim()).filter(Boolean),
    },
    {
      type: 'number',
      name: 'debounce_ms',
      message: 'Debounce delay in ms (wait time after a change before pushing):',
      default: existing?.auto_sync?.debounce_ms ?? 2000,
    },
  ]);

  // ── Step 4: Project CLAUDE.md files ──────────────────────────────────────
  console.log('\n' + chalk.bold.underline('Step 4 of 4 — Project CLAUDE.md Files') + '\n');
  console.log('Each Claude Code project can have a ' + chalk.cyan('CLAUDE.md') + ' file at its root.');
  console.log('These contain project-specific instructions Claude reads at the start of every session.\n');
  console.log(chalk.dim('  Only the CLAUDE.md file is backed up from each path — not your source code.\n'));
  console.log(chalk.dim('  Example paths:'));
  console.log(chalk.dim(`  ${join(homedir(), 'projects', 'my-app')}`));
  console.log(chalk.dim(`  ${join(homedir(), 'work', 'client-site')}\n`));

  const { claude_md_dirs } = await inquirer.prompt([
    {
      type: 'input',
      name: 'claude_md_dirs',
      message: 'Project root directories with CLAUDE.md (comma-separated, blank to skip):',
      default: existing?.claude_md_dirs?.join(', ') || '',
      filter: v => v.split(',').map(s => s.trim()).filter(Boolean),
    },
  ]);

  // ── Save & connect ───────────────────────────────────────────────────────
  console.log('');

  const config = {
    backend: 'github',
    github: {
      pat: pat.trim(),
      repo: repo.trim(),
      branch: branch.trim(),
    },
    watched_dirs,
    claude_md_dirs,
    exclude,
    auto_sync: { debounce_ms },
  };

  saveConfig(config);
  log.success('Config saved  (~/.config/claude-code-backup/config.json, chmod 600)');

  try {
    await ensureRepo(config);
    log.success('GitHub setup complete\n');
    log.info('Next steps:');
    log.dim('  claude-code-backup push                — do your first backup now');
    log.dim('  claude-code-backup service install     — enable auto-sync on login');
  } catch (err) {
    log.error(`GitHub setup failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}
