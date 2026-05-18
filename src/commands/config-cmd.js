import chalk from 'chalk';
import { loadConfig, saveConfig, requireConfig, expandPath } from '../core/config.js';
import { log } from '../utils/logger.js';

export function runConfig(action, key, value) {
  switch (action) {
    case 'show':           return showConfig();
    case 'set':            return setConfig(key, value);
    case 'add-dir':        return addDir(key);
    case 'remove-dir':     return removeDir(key);
    case 'add-project':    return addProject(key);
    case 'remove-project': return removeProject(key);
    default:
      log.error(`Unknown action: "${action}"`);
      log.info('Valid actions:');
      log.dim('  show');
      log.dim('  set <key> <value>');
      log.dim('  add-dir <path>         — fully mirror a directory');
      log.dim('  remove-dir <path>');
      log.dim('  add-project <path>     — back up only CLAUDE.md from a project root');
      log.dim('  remove-project <path>');
      process.exit(1);
  }
}

function showConfig() {
  const config = loadConfig();
  if (!config) {
    log.warn('Not configured yet. Run: claude-code-backup init');
    return;
  }
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.github?.pat) {
    safe.github.pat = safe.github.pat.slice(0, 8) + '••••••••';
  }
  console.log(chalk.bold('\nCurrent config:\n'));
  console.log(JSON.stringify(safe, null, 2));
  console.log('');
}

function setConfig(key, value) {
  if (!key || value === undefined) {
    log.error('Usage: claude-code-backup config set <key> <value>');
    log.dim('Example: claude-code-backup config set auto_sync.debounce_ms 3000');
    process.exit(1);
  }
  const config = requireConfig();
  const parts = key.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  let parsed = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (!isNaN(value) && value !== '') parsed = Number(value);

  obj[parts[parts.length - 1]] = parsed;
  saveConfig(config);
  log.success(`Set ${key} = ${key.includes('pat') ? '••••' : parsed}`);
}

function addDir(dirPath) {
  if (!dirPath) {
    log.error('Usage: claude-code-backup config add-dir <path>');
    process.exit(1);
  }
  const config = requireConfig();
  const expanded = expandPath(dirPath);
  if (config.watched_dirs.some(d => d === dirPath || d === expanded)) {
    log.warn('Directory is already in the watch list');
    return;
  }
  config.watched_dirs.push(expanded);
  saveConfig(config);
  log.success(`Added watched dir: ${expanded}`);
}

function removeDir(dirPath) {
  if (!dirPath) {
    log.error('Usage: claude-code-backup config remove-dir <path>');
    process.exit(1);
  }
  const config = requireConfig();
  const expanded = expandPath(dirPath);
  const before = config.watched_dirs.length;
  config.watched_dirs = config.watched_dirs.filter(
    d => d !== dirPath && d !== expanded
  );
  if (config.watched_dirs.length < before) {
    saveConfig(config);
    log.success(`Removed watched dir: ${expanded}`);
  } else {
    log.warn('Directory not found in watch list');
  }
}

function addProject(dirPath) {
  if (!dirPath) {
    log.error('Usage: claude-code-backup config add-project <project-root-path>');
    log.dim('Only the CLAUDE.md file at that path will be backed up.');
    process.exit(1);
  }
  const config = requireConfig();
  if (!config.claude_md_dirs) config.claude_md_dirs = [];
  const expanded = expandPath(dirPath);
  if (config.claude_md_dirs.some(d => d === dirPath || d === expanded)) {
    log.warn('Project is already in the list');
    return;
  }
  config.claude_md_dirs.push(expanded);
  saveConfig(config);
  log.success(`Added project: ${expanded}`);
  log.dim(`Will back up: ${expanded}/CLAUDE.md`);
}

function removeProject(dirPath) {
  if (!dirPath) {
    log.error('Usage: claude-code-backup config remove-project <project-root-path>');
    process.exit(1);
  }
  const config = requireConfig();
  if (!config.claude_md_dirs) {
    log.warn('No projects configured');
    return;
  }
  const expanded = expandPath(dirPath);
  const before = config.claude_md_dirs.length;
  config.claude_md_dirs = config.claude_md_dirs.filter(
    d => d !== dirPath && d !== expanded
  );
  if (config.claude_md_dirs.length < before) {
    saveConfig(config);
    log.success(`Removed project: ${expanded}`);
  } else {
    log.warn('Project not found in list');
  }
}
