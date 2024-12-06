import chalk from 'chalk';

export function logger(message, level = 'info', value = '') {
    const now = new Date().toISOString();
    const colors = {
        info: chalk.blue,
        warn: chalk.yellow,
        error: chalk.red,
        success: chalk.green,
        debug: chalk.magenta,
    };

    const color = colors[level] || chalk.white;
    const levelTag = `[${level.toUpperCase()}]`;
    const timestamp = `[${now}]`;

    const formattedMessage = `${color(timestamp)} ${color(levelTag)} ${chalk.white(message)}`;

    const formattedValue =
        value && typeof value === 'object'
            ? ` ${chalk.green(JSON.stringify(value, null, 2))}` 
            : value
            ? ` ${chalk.green(value)}`
            : '';

    console.log(`${formattedMessage}${formattedValue}`);
}
