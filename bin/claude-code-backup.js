#!/usr/bin/env node

import { program } from 'commander';
import { runInit } from '../src/commands/init.js';
import { runPush } from '../src/commands/push.js';
import { runPull } from '../src/commands/pull.js';
import { runWatch } from '../src/commands/watch.js';
import { runStatus } from '../src/commands/status.js';
import { runService } from '../src/commands/service.js';
import { runConfig } from '../src/commands/config-cmd.js';

program
  .name('claude-code-backup')
  .description('Backup and auto-sync Claude Code memory and settings to GitHub')
  .version('1.0.1');

program
  .command('init')
  .description('Interactive setup — configure GitHub repo and watched directories')
  .action(runInit);

program
  .command('push')
  .description('Manually push a backup to GitHub right now')
  .option('-m, --message <msg>', 'Custom commit message')
  .action(runPush);

program
  .command('pull')
  .description('Restore files from a GitHub backup')
  .option('--dry-run', 'Preview what would be restored without writing any files')
  .option('--history', 'Browse commit history and pick a specific version to restore')
  .action(runPull);

program
  .command('watch')
  .description('Start the file watcher — auto-syncs changes to GitHub')
  .option('--interval <minutes>', 'Poll every N minutes instead of real-time file watching')
  .action(runWatch);

program
  .command('status')
  .description('Show last backup time and any pending local changes')
  .action(runStatus);

program
  .command('service <action>')
  .description('Manage the launchd background service: install | uninstall | status | logs')
  .action(runService);

program
  .command('config <action> [key] [value]')
  .description('Manage config: show | set <key> <value> | add-dir <path> | remove-dir <path>')
  .action(runConfig);

program.parseAsync();
