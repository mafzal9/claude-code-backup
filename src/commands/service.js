import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { LAUNCHD_PLIST, LAUNCHD_LABEL, LOG_FILE, ERROR_LOG_FILE } from '../core/config.js';
import { log } from '../utils/logger.js';

const execAsync = promisify(exec);

function buildPlist(nodePath, scriptPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>watch</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>

  <key>StandardErrorPath</key>
  <string>${ERROR_LOG_FILE}</string>
</dict>
</plist>`;
}

async function loadService() {
  const uid = process.getuid();
  // Try modern launchctl first (macOS 13+), fall back to legacy
  try {
    await execAsync(`launchctl bootstrap gui/${uid} "${LAUNCHD_PLIST}"`);
  } catch {
    await execAsync(`launchctl load -w "${LAUNCHD_PLIST}"`);
  }
}

async function unloadService() {
  const uid = process.getuid();
  try {
    await execAsync(`launchctl bootout gui/${uid}/${LAUNCHD_LABEL}`);
  } catch {
    try {
      await execAsync(`launchctl unload -w "${LAUNCHD_PLIST}"`);
    } catch {}
  }
}

async function installService() {
  const nodePath = process.execPath;   // path to the node binary running this script
  const scriptPath = process.argv[1];  // absolute path to claude-code-backup.js

  const plist = buildPlist(nodePath, scriptPath);
  writeFileSync(LAUNCHD_PLIST, plist, 'utf8');
  log.info(`Plist written to: ${LAUNCHD_PLIST}`);

  try {
    // Unload first in case already loaded
    await unloadService();
  } catch {}

  try {
    await loadService();
    log.success('Service installed and started');
    log.dim(`Node:    ${nodePath}`);
    log.dim(`Script:  ${scriptPath}`);
    log.dim(`Stdout:  ${LOG_FILE}`);
    log.dim(`Stderr:  ${ERROR_LOG_FILE}`);
    log.info('The watcher will now auto-start on every login');
  } catch (err) {
    log.error(`Failed to start service: ${err.message}`);
    log.dim('Try running manually: launchctl load -w ' + LAUNCHD_PLIST);
  }
}

async function uninstallService() {
  if (!existsSync(LAUNCHD_PLIST)) {
    log.warn('Service is not installed');
    return;
  }
  try {
    await unloadService();
    log.success('Service stopped and unloaded');
  } catch (err) {
    log.warn(`Could not unload: ${err.message}`);
  }
  unlinkSync(LAUNCHD_PLIST);
  log.success('Service plist removed — auto-sync disabled');
}

async function serviceStatus() {
  if (!existsSync(LAUNCHD_PLIST)) {
    log.warn('Service is not installed');
    log.dim('Run: claude-code-backup service install');
    return;
  }

  const uid = process.getuid();
  try {
    // Modern approach
    const { stdout } = await execAsync(
      `launchctl print gui/${uid}/${LAUNCHD_LABEL} 2>/dev/null`
    );
    const pidMatch = stdout.match(/pid\s*=\s*(\d+)/);
    if (pidMatch) {
      log.success(`Service is running  (PID: ${pidMatch[1]})`);
    } else {
      log.warn('Service is loaded but not currently running');
    }
  } catch {
    // Fallback to list
    try {
      const { stdout } = await execAsync(`launchctl list | grep "${LAUNCHD_LABEL}"`);
      const parts = stdout.trim().split(/\s+/);
      if (parts[0] !== '-') {
        log.success(`Service is running  (PID: ${parts[0]})`);
      } else {
        log.warn(`Service is loaded but stopped  (last exit code: ${parts[1]})`);
      }
    } catch {
      log.warn('Service is not running');
    }
  }

  log.dim(`Plist:  ${LAUNCHD_PLIST}`);
  log.dim(`Log:    ${LOG_FILE}`);
  log.dim(`Errors: ${ERROR_LOG_FILE}`);
}

async function serviceLogs() {
  if (!existsSync(LOG_FILE)) {
    log.warn(`Log file not found: ${LOG_FILE}`);
    log.dim('The service may not have run yet');
    return;
  }
  log.dim(`Tailing: ${LOG_FILE}  (Ctrl+C to stop)\n`);
  const tail = spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
  tail.on('close', () => process.exit(0));
  process.on('SIGINT', () => { tail.kill(); process.exit(0); });
}

export async function runService(action) {
  switch (action) {
    case 'install':   return installService();
    case 'uninstall': return uninstallService();
    case 'status':    return serviceStatus();
    case 'logs':      return serviceLogs();
    default:
      log.error(`Unknown action: "${action}"`);
      log.info('Valid actions: install | uninstall | status | logs');
      process.exit(1);
  }
}
