/**
 * @file logger.ts
 * @description Centralized Enterprise Winston Logger Configuration.
 * Provides structured JSON logging in production and colorized, file-labeled console
 * formatting in development/test environments.
 * 
 * Features:
 * - Scoped child logger factory (`createLogger(__filename)`) tagging every entry with its source file.
 * - Dynamic file-origin resolution fallback via V8 CallSites if not explicitly provided.
 * - Standardized log levels (debug, info, warn, error).
 * - Full error stack trace serialization and metadata sanitization.
 */

import winston from "winston";
import path from "path";

/**
 * Extracts the calling file name from the V8 call stack.
 * Used as a fallback when a log entry is emitted without an explicit file tag.
 * 
 * @returns {string} The base name of the caller file (e.g. "HotelController.ts"), or "app"
 */
function getCallerFileName(): string {
  try {
    const originalPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = (err.stack as unknown as NodeJS.CallSite[]) || [];
    Error.prepareStackTrace = originalPrepareStackTrace;

    // Iterate through the stack frames to find the first frame outside winston and logger.ts
    for (let i = 2; i < stack.length; i++) {
      const fileName = stack[i]?.getFileName();
      if (fileName && !fileName.includes("logger.ts") && !fileName.includes("node_modules")) {
        return path.basename(fileName);
      }
    }
  } catch {
    // Fail silently and return default if V8 call-site introspection is restricted
  }
  return "app";
}

/**
 * Custom Winston format that guarantees each log entry contains a `file` attribute.
 */
const addFileContext = winston.format((info) => {
  if (!info.file) {
    info.file = getCallerFileName();
  }
  return info;
});

/**
 * Human-readable console log format used for local development and test runs.
 * Formats: `YYYY-MM-DD HH:mm:ss.SSS [LEVEL] [filename.ts]: message { ...metadata }`
 */
const devConsoleFormat = winston.format.printf(({ timestamp, level, message, file, stack, ...meta }) => {
  // Strip default service meta from inline display for cleaner terminal output
  const { service, ...customMeta } = meta;
  const metaStr = Object.keys(customMeta).length > 0 ? ` ${JSON.stringify(customMeta)}` : "";
  const errorStack = stack ? `\n  Stack: ${stack}` : "";
  const fileTag = file ? `[${file}]` : "[app]";

  return `${timestamp} [${level}] ${fileTag}: ${message}${metaStr}${errorStack}`;
});

/**
 * Production JSON format with mandatory timestamp, error serialization, and structured fields.
 */
const prodJsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  addFileContext(),
  winston.format.json()
);

/**
 * Determines whether the current runtime environment is production.
 */
const isProduction = process.env.NODE_ENV === "production";

/**
 * Root Winston Logger instance configured with console transport.
 */
const rootLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format: isProduction
    ? prodJsonFormat
    : winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
        winston.format.colorize({ all: true }),
        addFileContext(),
        devConsoleFormat
      ),
  defaultMeta: { service: "hotel-offer-orchestrator" },
  transports: [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === "test" && process.env.TEST_LOGS !== "true",
    }),
  ],
  exitOnError: false,
});

/**
 * Factory function to create a scoped child logger explicitly tagged with a source file.
 * 
 * @example
 * ```typescript
 * import { createLogger } from "../logger";
 * const logger = createLogger(__filename);
 * logger.info("Order processed successfully", { orderId: 123 });
 * // Output: 2026-10-25 14:45:00.000 [info] [OrderService.ts]: Order processed successfully {"orderId":123}
 * ```
 * 
 * @param {string} filenameOrModule - The full `__filename` or module name
 * @returns {winston.Logger} A Winston child logger bound with the file metadata
 */
export function createLogger(filenameOrModule: string): winston.Logger {
  const cleanName = path.basename(filenameOrModule);
  return rootLogger.child({ file: cleanName });
}

/**
 * Default global logger export for backwards compatibility.
 */
export const logger = rootLogger;

export default rootLogger;
