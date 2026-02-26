import { InvocationContext } from "@azure/functions";
import * as fs from "fs";
import * as path from "path";

/**
 * Log levels supported by the LoggerService.
 */
export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
}

/**
 * Configuration for creating a LoggerService instance.
 */
export interface LoggerConfig {
    /** Azure Functions invocation context for context-level logging */
    context: InvocationContext;
    /** Identifier for the PR being reviewed (e.g., "AzDo:ProjectName/123" or "GitHub:owner/repo#45") */
    prIdentifier: string;
    /** Whether to enable file logging (default: true) */
    enableFileLogging?: boolean;
    /** Whether to enable debug-level logging (default: false) */
    enableDebug?: boolean;
}

/**
 * LoggerService — Unified logging to Azure InvocationContext and file.
 *
 * Creates a per-review log file under `logs/{YYYY-MM-DD}/` with a filename
 * derived from the platform and PR identifier. Every log message is written
 * to both the Azure context (visible in Application Insights / function logs)
 * and to the local log file for persistent storage and debugging.
 *
 * Usage:
 * ```ts
 * const logger = LoggerService.create({ context, prIdentifier: "GitHub:owner/repo#1" });
 * logger.info("REVIEW", "Starting review");
 * logger.error("AI", "Failed to get response", error);
 * logger.dispose(); // flush and close the file stream
 * ```
 */
export class LoggerService {
    private context: InvocationContext;
    private logFilePath: string | null = null;
    private fileStream: fs.WriteStream | null = null;
    private enableDebug: boolean;
    private prIdentifier: string;

    private constructor(config: LoggerConfig) {
        this.context = config.context;
        this.prIdentifier = config.prIdentifier;
        this.enableDebug = config.enableDebug ?? false;

        if (config.enableFileLogging !== false) {
            this.initFileLogging(config.prIdentifier);
        }
    }

    /**
     * Create a new LoggerService instance scoped to a specific review.
     */
    static create(config: LoggerConfig): LoggerService {
        return new LoggerService(config);
    }

    // ─── Public Logging Methods ──────────────────────────────────────

    /**
     * Log an informational message.
     * @param tag  Short category tag (e.g., "REVIEW", "FILES", "AI")
     * @param message  Human-readable log message
     */
    info(tag: string, message: string): void {
        this.log(LogLevel.INFO, tag, message);
    }

    /**
     * Log a warning message.
     */
    warn(tag: string, message: string): void {
        this.log(LogLevel.WARN, tag, message);
    }

    /**
     * Log an error message with an optional Error object.
     */
    error(tag: string, message: string, err?: Error | unknown): void {
        const errorDetail = err instanceof Error
            ? `${message} | ${err.message}\n${err.stack}`
            : err
                ? `${message} | ${String(err)}`
                : message;
        this.log(LogLevel.ERROR, tag, errorDetail);
    }

    /**
     * Log a debug message (only if debug is enabled).
     */
    debug(tag: string, message: string): void {
        if (!this.enableDebug) return;
        this.log(LogLevel.DEBUG, tag, message);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────

    /**
     * Flush and close the file stream. Call this when the review is complete.
     */
    dispose(): void {
        if (this.fileStream) {
            this.fileStream.end();
            this.fileStream = null;
        }
    }

    /**
     * Returns the path to the current log file, or null if file logging is disabled.
     */
    getLogFilePath(): string | null {
        return this.logFilePath;
    }

    // ─── Internal ────────────────────────────────────────────────────

    private log(level: LogLevel, tag: string, message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `${timestamp} [${level}] [${tag}] ${message}`;

        // 1. Log to Azure InvocationContext
        this.logToContext(level, formattedMessage);

        // 2. Log to file
        this.logToFile(formattedMessage);
    }

    private logToContext(level: LogLevel, message: string): void {
        switch (level) {
            case LogLevel.ERROR:
                this.context.error(message);
                break;
            case LogLevel.WARN:
                this.context.warn(message);
                break;
            case LogLevel.DEBUG:
                this.context.debug(message);
                break;
            case LogLevel.INFO:
            default:
                this.context.log(message);
                break;
        }
    }

    private logToFile(message: string): void {
        if (this.fileStream) {
            this.fileStream.write(message + "\n");
        }
    }

    /**
     * Initializes file logging.
     * Creates the log directory structure if it doesn't exist,
     * and opens a write stream to the log file.
     *
     * Log file path: `logs/{YYYY-MM-DD}/{sanitizedPrId}_{timestamp}.log`
     */
    private initFileLogging(prIdentifier: string): void {
        try {
            const now = new Date();
            const dateFolder = now.toISOString().slice(0, 10); // YYYY-MM-DD
            const timestamp = now.toISOString().replace(/[:.]/g, "-"); // safe for filenames

            // Sanitize the PR identifier for use in a filename
            const sanitizedId = prIdentifier
                .replace(/[^a-zA-Z0-9_#-]/g, "_") // replace unsafe chars
                .replace(/_+/g, "_")                // collapse multiple underscores
                .substring(0, 80);                   // cap length

            const logDir = path.resolve("logs", dateFolder);
            fs.mkdirSync(logDir, { recursive: true });

            const logFileName = `${sanitizedId}_${timestamp}.log`;
            this.logFilePath = path.join(logDir, logFileName);
            this.fileStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

            // Write a header to the log file
            const header = [
                `${"=".repeat(70)}`,
                `  AI Code Review Log`,
                `  PR:        ${prIdentifier}`,
                `  Started:   ${now.toISOString()}`,
                `${"=".repeat(70)}`,
                "",
            ].join("\n");
            this.fileStream.write(header + "\n");

        } catch (err) {
            // If file logging fails, continue without it — context logging still works
            this.context.warn(`[LOGGER] Failed to initialize file logging: ${err instanceof Error ? err.message : err}`);
            this.fileStream = null;
            this.logFilePath = null;
        }
    }
}
