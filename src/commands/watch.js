import { existsSync } from 'fs';
import chokidar from 'chokidar';
import { requireConfig, expandPath } from '../core/config.js';
import { push } from '../backends/github.js';
import { log } from '../utils/logger.js';

export async function runWatch(options) {
  const config = requireConfig();

  if (options.interval) {
    await runIntervalMode(config, parseFloat(options.interval));
    return;
  }

  const dirs = config.watched_dirs
    .map(expandPath)
    .filter(d => existsSync(d));

  if (dirs.length === 0) {
    log.error('No valid watched directories found — check your config');
    process.exit(1);
  }

  log.header('Claude Backup — File Watcher');
  for (const dir of dirs) log.dim(`  Watching: ${dir}`);
  log.dim(`  Debounce: ${config.auto_sync?.debounce_ms ?? 2000}ms`);
  log.dim('  Press Ctrl+C to stop\n');

  const debounceMs = config.auto_sync?.debounce_ms ?? 2000;
  let timer = null;
  let busy = false;

  const watcher = chokidar.watch(dirs, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: [/(^|[/\\])\.git([/\\]|$)/],
  });

  function scheduleSync() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (busy) return;
      busy = true;
      const ts = new Date().toLocaleTimeString();
      try {
        const count = await push(config);
        if (count > 0) {
          log.success(`[${ts}] Synced ${count} file(s) → GitHub`);
        } else {
          log.dim(`[${ts}] No changes to push`);
        }
      } catch (err) {
        log.error(`[${ts}] Sync failed: ${err.message}`);
      } finally {
        busy = false;
      }
    }, debounceMs);
  }

  watcher
    .on('add', scheduleSync)
    .on('change', scheduleSync)
    .on('unlink', scheduleSync)
    .on('error', err => log.error(`Watcher error: ${err.message}`));

  function shutdown() {
    watcher.close().then(() => {
      log.info('File watcher stopped');
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', () => { console.log(''); shutdown(); });
}

async function runIntervalMode(config, minutes) {
  log.header(`Claude Backup — Interval Sync (every ${minutes}m)`);

  async function sync() {
    const ts = new Date().toLocaleTimeString();
    try {
      const count = await push(config);
      if (count > 0) {
        log.success(`[${ts}] Synced ${count} file(s) → GitHub`);
      } else {
        log.dim(`[${ts}] No changes`);
      }
    } catch (err) {
      log.error(`[${ts}] Sync failed: ${err.message}`);
    }
  }

  await sync();
  const ms = minutes * 60 * 1000;
  setInterval(sync, ms);

  process.on('SIGTERM', () => { log.info('Interval sync stopped'); process.exit(0); });
  process.on('SIGINT',  () => { console.log(''); log.info('Interval sync stopped'); process.exit(0); });
}
