import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { expandPath, sanitizeDirName } from './config.js';

// Prefix used in the repo and manifest to distinguish project CLAUDE.md entries
// from regular watched-dir entries so the two namespaces never collide.
export const CLAUDE_MD_PREFIX = 'claude_md_';

function globMatch(name, pattern) {
  if (!pattern.includes('*')) return name === pattern;
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  );
  return re.test(name);
}

function shouldExclude(name, excludes) {
  return excludes.some(p => globMatch(name, p));
}

function walkDir(dir, excludes, results, relPath) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldExclude(entry.name, excludes)) continue;
    const fullPath = join(dir, entry.name);
    const rel = relPath ? join(relPath, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walkDir(fullPath, excludes, results, rel);
    } else if (entry.isFile()) {
      results.push({ src: fullPath, rel });
    }
  }
}

export function collectFiles(config) {
  const excludes = config.exclude || [];
  const result = [];

  // Full recursive backup of each watched dir (e.g. ~/.claude)
  for (const rawDir of config.watched_dirs) {
    const dir = expandPath(rawDir);
    if (!existsSync(dir)) continue;

    const label = sanitizeDirName(dir);
    const files = [];
    walkDir(dir, excludes, files, '');

    for (const { src, rel } of files) {
      result.push({ src, dest: join(label, rel) });
    }
  }

  // Only the CLAUDE.md file from each project root
  for (const rawDir of (config.claude_md_dirs || [])) {
    const dir = expandPath(rawDir);
    const claudeMd = join(dir, 'CLAUDE.md');
    if (!existsSync(claudeMd)) continue;

    const label = CLAUDE_MD_PREFIX + sanitizeDirName(dir);
    result.push({ src: claudeMd, dest: join(label, 'CLAUDE.md') });
  }

  return result;
}

export function buildManifest(config) {
  const manifest = {};

  // Watched dirs
  for (const rawDir of config.watched_dirs) {
    const dir = expandPath(rawDir);
    manifest[sanitizeDirName(dir)] = dir;
  }

  // Project CLAUDE.md dirs — prefixed so restore knows to target the project root
  for (const rawDir of (config.claude_md_dirs || [])) {
    const dir = expandPath(rawDir);
    manifest[CLAUDE_MD_PREFIX + sanitizeDirName(dir)] = dir;
  }

  return manifest;
}
