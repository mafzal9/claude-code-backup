import chalk from 'chalk';
import { requireConfig, LAUNCHD_PLIST, LAUNCHD_LABEL } from '../core/config.js';
import { getStatus } from '../backends/github.js';
import { collectFiles } from '../core/collector.js';
import { log } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

async function getServiceStatus() {
  if (!existsSync(LAUNCHD_PLIST)) return 'not installed';
  try {
    const uid = process.getuid();
    const { stdout } = await execAsync(`launchctl print gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`);
    return stdout.includes('pid') ? 'running' : 'loaded (not running)';
  } catch {
    try {
      const { stdout } = await execAsync(`launchctl list | grep "${LAUNCHD_LABEL}"`);
      const parts = stdout.trim().split(/\s+/);
      return parts[0] !== '-' ? `running (PID ${parts[0]})` : 'loaded (stopped)';
    } catch {
      return 'not running';
    }
  }
}

export async function runStatus() {
  const config = requireConfig();

  log.header('Claude Backup Status');

  // Watched dirs + file count
  const files = collectFiles(config);
  const claudeMdCount = files.filter(f => f.dest.startsWith('claude_md_')).length;
  const watchedCount  = files.length - claudeMdCount;

  console.log(chalk.bold('Watched dirs:'));
  for (const dir of config.watched_dirs) {
    console.log(`  ${dir}`);
  }
  console.log(`${chalk.bold('Files tracked:')} ${watchedCount}`);

  const claudeMdDirs = config.claude_md_dirs || [];
  if (claudeMdDirs.length > 0) {
    console.log(`\n${chalk.bold('Project CLAUDE.md dirs:')}`);
    for (const dir of claudeMdDirs) {
      console.log(`  ${dir}`);
    }
    console.log(`${chalk.bold('CLAUDE.md files:')} ${claudeMdCount}`);
  }

  // GitHub
  console.log(`\n${chalk.bold('GitHub:')} ${config.github.repo}  [${config.github.branch}]`);
  const status = await getStatus(config);
  if (status?.lastCommit) {
    const c = status.lastCommit;
    const dateStr = c.date ? String(c.date).slice(0, 19).replace('T', ' ') : 'unknown';
    console.log(`${chalk.bold('Last backup:')}  ${dateStr}`);
    console.log(`${chalk.bold('Commit:')}       ${String(c.hash).slice(0, 7)}  ${c.message}`);
    if (status.pending > 0) {
      console.log(`${chalk.bold('Local changes:')} ${chalk.yellow(status.pending + ' file(s) not yet pushed')}`);
    } else {
      console.log(`${chalk.bold('Sync status:')}  ${chalk.green('Up to date')}`);
    }
  } else {
    console.log(chalk.dim('  No backups yet. Run: claude-code-backup push'));
  }

  // Launchd service
  const svc = await getServiceStatus();
  const svcColor = svc.startsWith('running') ? chalk.green : chalk.yellow;
  console.log(`\n${chalk.bold('Auto-sync service:')} ${svcColor(svc)}`);
  if (!svc.startsWith('running')) {
    console.log(chalk.dim('  Run: claude-code-backup service install'));
  }

  console.log('');
}
