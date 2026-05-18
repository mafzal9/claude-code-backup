import { existsSync, mkdirSync, copyFileSync, cpSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { requireConfig, CONFIG_DIR, REPO_DIR, expandPath } from '../core/config.js';
import { fetchForRestore, getHistory } from '../backends/github.js';
import { log, spinner } from '../utils/logger.js';

function walkRepoDir(dir, results = [], rel = '') {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'backup-manifest.json') continue;
    const fullPath = join(dir, entry.name);
    const relPath = rel ? join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walkRepoDir(fullPath, results, relPath);
    } else if (entry.isFile()) {
      results.push({ repoPath: fullPath, rel: relPath });
    }
  }
  return results;
}

function buildRestoreOps(manifest) {
  const repoFiles = walkRepoDir(REPO_DIR);
  const ops = [];

  for (const { repoPath, rel } of repoFiles) {
    // rel looks like "Users_apple_.claude/settings.json"
    const sep = rel.indexOf('/') !== -1 ? rel.indexOf('/') : rel.indexOf('\\');
    const label = sep === -1 ? rel : rel.slice(0, sep);
    const rest = sep === -1 ? '' : rel.slice(sep + 1);

    const targetBase = manifest[label];
    if (!targetBase) continue;

    ops.push({
      src: repoPath,
      dest: join(expandPath(targetBase), rest),
    });
  }

  return ops;
}

export async function runPull(options) {
  const config = requireConfig();

  let ref;

  if (options.history) {
    const spin = spinner('Loading commit history...').start();
    const history = await getHistory(config);
    spin.stop();

    if (history.length === 0) {
      log.warn('No commits found. Run: claude-backup push first');
      return;
    }

    const { chosen } = await inquirer.prompt([
      {
        type: 'list',
        name: 'chosen',
        message: 'Select a backup to restore:',
        choices: history.map(c => ({
          name: `${String(c.date).slice(0, 16)}  ${c.message}  (${String(c.hash).slice(0, 7)})`,
          value: c.hash,
        })),
      },
    ]);
    ref = chosen;
  }

  const spin = spinner('Fetching backup from GitHub...').start();
  let manifest;
  try {
    manifest = await fetchForRestore(config, ref);
    spin.stop();
  } catch (err) {
    spin.fail(`Fetch failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }

  if (!manifest || Object.keys(manifest).length === 0) {
    log.error('No backup manifest found. The repo may be empty or from an older version.');
    return;
  }

  const ops = buildRestoreOps(manifest);
  if (ops.length === 0) {
    log.warn('No files to restore — watched dirs may not match this backup');
    return;
  }

  if (options.dryRun) {
    log.header('Dry run — files that would be restored:');
    for (const { dest } of ops) {
      console.log(chalk.cyan('  →'), dest);
    }
    log.info(`\nTotal: ${ops.length} file(s)`);
    return;
  }

  log.info(`Will restore ${ops.length} file(s) to:`);
  const preview = ops.slice(0, 8);
  for (const { dest } of preview) {
    console.log(chalk.dim('  ' + dest));
  }
  if (ops.length > 8) {
    console.log(chalk.dim(`  ... and ${ops.length - 8} more`));
  }

  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed? A safety snapshot of your current state will be created first.',
      default: false,
    },
  ]);

  if (!confirmed) {
    log.info('Restore cancelled');
    return;
  }

  // Safety snapshot — copy current watched dirs to a timestamped backup
  const snapshotDir = join(CONFIG_DIR, `pre-restore-${Date.now()}`);
  const snapSpin = spinner('Creating safety snapshot of current state...').start();
  mkdirSync(snapshotDir, { recursive: true });
  for (const rawDir of config.watched_dirs) {
    const dir = expandPath(rawDir);
    if (existsSync(dir)) {
      const label = dir.replace(/[^a-zA-Z0-9]/g, '_');
      try {
        cpSync(dir, join(snapshotDir, label), { recursive: true });
      } catch {}
    }
  }
  snapSpin.succeed(`Safety snapshot saved → ${snapshotDir}`);

  // Restore
  const restoreSpin = spinner(`Restoring ${ops.length} files...`).start();
  let count = 0;
  for (const { src, dest } of ops) {
    mkdirSync(dirname(dest), { recursive: true });
    try {
      copyFileSync(src, dest);
      count++;
    } catch {}
  }
  restoreSpin.succeed(`Restored ${count} file(s)`);
  log.success('Restore complete');
}
