import * as path from "path";

class Logger {
  private static ANSI_COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m"
  };

  static info(message: string): void {
    console.info(this.date(), this.colorize("INFO", this.ANSI_COLORS.blue), this.colorize(message, this.ANSI_COLORS.cyan));
  }

  static warn(message: string): void {
    console.warn(this.date(), this.colorize("WARN", this.ANSI_COLORS.yellow), this.colorize(message, this.ANSI_COLORS.yellow + this.ANSI_COLORS.bright));
  }

  static error(message: string): void {
    console.error(this.date(), this.colorize("ERROR", this.ANSI_COLORS.red), this.colorize(message, this.ANSI_COLORS.red + this.ANSI_COLORS.bright), this.getCallerPath());
  }

  static debug(message: string | object): void {
    if (process.argv.includes('--debug'))
      console.debug(this.date(), this.colorize("DEBUG", this.ANSI_COLORS.gray), message, this.getCallerPath());
  }

  static date(): string {
    const date = new Date();
    return `${this.colorize("[", this.ANSI_COLORS.gray)}${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}:${this.colorize(date.getMilliseconds().toString(), this.ANSI_COLORS.dim)}${this.colorize("]", this.ANSI_COLORS.gray)}`;
  }

  static chat(message: string): void {
    console.info(this.date(), this.colorize("CHAT", this.ANSI_COLORS.green), this.chatColors(message));
  }

  static getCallerPath(): string {
    const err = new Error();
    const stack = err.stack?.split("\n");
    if (stack && stack.length > 3) {
      const callerLine = stack[3].trim();
      const match = callerLine.match(/\((.*):(\d+):(\d+)\)$/);
      if (match) {
        const filePath = path.relative(process.cwd(), match[1]);
        const lineNumber = match[2];
        return `${this.colorize(filePath, this.ANSI_COLORS.magenta)}:${this.colorize(lineNumber, this.ANSI_COLORS.green)}`;
      }
    }
    return this.colorize("Unknown caller", this.ANSI_COLORS.magenta);
  }

  static chatColors(text: string): string {
    const ansiColors: { [key: string]: string } = {
      "0": "\x1b[30m", "1": "\x1b[34m", "2": "\x1b[32m", "3": "\x1b[36m",
      "4": "\x1b[31m", "5": "\x1b[35m", "6": "\x1b[33m", "7": "\x1b[37m",
      "8": "\x1b[90m", "9": "\x1b[94m", "a": "\x1b[92m", "b": "\x1b[96m",
      "c": "\x1b[91m", "d": "\x1b[95m", "e": "\x1b[93m", "f": "\x1b[97m",
      "r": "\x1b[0m"
    };
    return text.replace(/§[\da-fk-or]/g, m => ansiColors[m[1]] || "") + "\x1b[0m";
  }

  private static colorize(text: string, color: string): string {
    return `${color}${text}${this.ANSI_COLORS.reset}`;
  }
}

export { Logger };