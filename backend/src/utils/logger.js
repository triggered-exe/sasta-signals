import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Define level based on environment
const level = () => {
    const env = process.env.NODE_ENV || 'development';
    const isDevelopment = env === 'development';
    return isDevelopment ? 'debug' : 'info';
};

// Define colors for each level
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue',
};

winston.addColors(colors);

// Define format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf((info) => {
        const { timestamp, level, message, stack, ...meta } = info;
        let log = `${timestamp} [${level}]: ${message}`;
        if (stack) {
            log += `\n${stack}`;
        }
        if (Object.keys(meta).length > 0) {
            // Remove internal winston sybmols if any
            const metaClean = { ...meta };
            const metaStr = JSON.stringify(metaClean, (key, value) => {
                if (value instanceof Error) {
                    return {
                        message: value.message,
                        stack: value.stack,
                        ...value
                    };
                }
                return value;
            }, 2);
            if (metaStr !== '{}') {
                log += `\n${metaStr}`;
            }
        }
        return log;
    })
);

// Define format for file output (no colors)
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Define transports
const transports = [
    // Console transport
    new winston.transports.Console({
        format: consoleFormat,
    }),

    // Error log file
    new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        format: fileFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 5,
    }),

    // Combined log file
    new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        format: fileFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 5,
        tailable: true,
    }),
];

// Create the logger
const logger = winston.createLogger({
    level: level(),
    levels,
    transports,
    exitOnError: false,
});

export default logger;
