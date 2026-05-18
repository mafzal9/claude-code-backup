import chalk from 'chalk';
import ora from 'ora';

export const log = {
  info:    (msg) => console.log(chalk.blue('ℹ'), chalk.reset(msg)),
  success: (msg) => console.log(chalk.green('✔'), chalk.reset(msg)),
  warn:    (msg) => console.log(chalk.yellow('⚠'), chalk.reset(msg)),
  error:   (msg) => console.error(chalk.red('✖'), chalk.reset(msg)),
  dim:     (msg) => console.log(chalk.dim(msg)),
  header:  (msg) => console.log('\n' + chalk.bold.cyan(msg) + '\n'),
};

export function spinner(text) {
  return ora({ text, color: 'cyan' });
}
