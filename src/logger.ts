/**
 * Simple structured logger for the Perplexity MCP Server
 * Outputs to stderr to avoid interfering with STDIO transport
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
};

/**
 * Gets the configured log level from environment variable
 * Defaults to ERROR to minimize noise in production
 */
function getLogLevel(): LogLevel {
  const level = process.env.PERPLEXITY_LOG_LEVEL?.toUpperCase();
  switch (level) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.ERROR;
  }
}

const currentLogLevel = getLogLevel();

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "[Unstringifiable]";
  }
}

/**
 * Formats a log message with timestamp and level
 */
function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const levelName = LOG_LEVEL_NAMES[level];

  if (meta && Object.keys(meta).length > 0) {
    return `[${timestamp}] ${levelName}: ${message} ${safeStringify(meta)}`;
  }

  return `[${timestamp}] ${levelName}: ${message}`;
}

/**
 * Logs a message if the configured log level allows it
 */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (level >= currentLogLevel) {
    const formatted = formatMessage(level, message, meta);
    console.error(formatted); // Use stderr to avoid interfering with STDIO
  }
}

/**
 * Structured logger interface
 */
export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.DEBUG, message, meta);
  },

  info(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.INFO, message, meta);
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.WARN, message, meta);
  },

  error(message: string, meta?: Record<string, unknown>): void {
    log(LogLevel.ERROR, message, meta);
  },
};
