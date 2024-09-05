import { inspect } from 'util';

class Logger {
    private static colors: { [key: string]: string } = {
        "0": "\u001B[30m", // Black
        "1": "\u001B[34m", // Dark Blue
        "2": "\u001B[32m", // Dark Green
        "3": "\u001B[36m", // Dark Aqua
        "4": "\u001B[31m", // Dark Red
        "5": "\u001B[35m", // Dark Purple
        "6": "\u001B[33m", // Gold
        "7": "\u001B[37m", // Light Gray
        "8": "\u001B[90m", // Dark Gray
        "9": "\u001B[94m", // Blue
        a: "\u001B[92m", // Green
        b: "\u001B[96m", // Aqua
        c: "\u001B[91m", // Red
        d: "\u001B[95m", // Light Purple
        e: "\u001B[93m", // Yellow
        f: "\u001B[97m", // White
        r: "\u001B[0m", // Reset
        l: "\u001B[1m", // Bold
    };

    static info(...data: any[]) {
        this.log('§7<§l§bINFO§7>§r', ...data);
    }

    static error(...data: any[]) {
        this.log('§7<§l§cERROR§7>§r', ...data);
    }

    static warn(...data: any[]) {
        this.log('§7<§l§eWARN§7>§r', ...data);
    }

    static debug(...data: any[]) {
        this.log('§7<§l§aDEBUG§7>§r', ...data);
    }

    static chat(...data: any[]): void {
        this.log('§7<§l§aCHAT§7>§r', ...data);
    }

    private static getTimestamp(): string {
        const date = new Date();
        let string = ``;
        string += `§7<§f${date.getHours().toString().padStart(2, '0')}:`
        string += `${date.getMinutes().toString().padStart(2, '0')}:`
        string += `${date.getSeconds().toString().padStart(2, '0')}:`
        string += `§8${date.getMilliseconds().toString().padStart(3, '0')}`
        string += `§7>§r`
        return this.colorize(string)[0];
    }

    private static log(...data: any[]) {
        console.log(this.getTimestamp(), ...this.colorize(...data));
    }

    private static colorize(...args: any[]): any[] {
        const regex = /§[\da-fklr]/g;

        return args.map(arg => {
            if (typeof arg !== 'string') return arg;
            return arg.replace(regex, match => {
                const color = this.colors[match[1]];
                return color || match;
            });
        });
    }
}

export { Logger };