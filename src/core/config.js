import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';

export const CONFIG_DIR = join(homedir(), '.config', 'claude-code-backup');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const REPO_DIR = join(CONFIG_DIR, 'repo');
export const LOG_FILE = join(CONFIG_DIR, 'watch.log');
export const ERROR_LOG_FILE = join(CONFIG_DIR, 'watch.error.log');
export const LAUNCHD_PLIST = join(
  homedir(), 'Library', 'LaunchAgents', 'com.claude-code-backup.watch.plist'
);
export const LAUNCHD_LABEL = 'com.claude-code-backup.watch';

export function ensureConfigDir() {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  try { chmodSync(CONFIG_FILE, 0o600); } catch {}
}

export function requireConfig() {
  const config = loadConfig();
  if (!config || !config.github?.pat || !config.github?.repo) {
    console.error('Not configured. Run: claude-code-backup init');
    process.exit(1);
  }
  return config;
}

export function expandPath(p) {
  if (typeof p !== 'string') return p;
  if (p.startsWith('~/') || p === '~') return join(homedir(), p.slice(1));
  return p;
}

export function sanitizeDirName(dirPath) {
  return dirPath
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
}
