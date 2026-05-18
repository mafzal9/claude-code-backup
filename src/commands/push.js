import { requireConfig } from '../core/config.js';
import { push } from '../backends/github.js';
import { log } from '../utils/logger.js';

export async function runPush(options) {
  const config = requireConfig();
  try {
    await push(config, options.message);
  } catch (err) {
    log.error(`Push failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}
