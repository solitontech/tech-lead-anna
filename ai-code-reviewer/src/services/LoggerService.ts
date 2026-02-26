import { InvocationContext } from "@azure/functions";

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

    /** Whether to enable debug-level logging (default: false) */
    enableDebug?: boolean;
}

/**
 * LoggerService — Unified logging to Azure InvocationContext.
 *
 * Every log message is written to the Azure context
 * (visible in Application Insights / function logs).
 *
 * Usage:
 * ```ts
 * const logger = LoggerService.create({ context, prIdentifier: "GitHub:owner/repo#1" });
 * logger.info("REVIEW", "Starting review");
 * logger.error("AI", "Failed to get response", error);
 * ```
 */
export class LoggerService {
    private context: InvocationContext;

    private enableDebug: boolean;
    private prIdentifier: string;

    private constructor(config: LoggerConfig) {
        this.context = config.context;
        this.prIdentifier = config.prIdentifier;
        this.enableDebug = config.enableDebug ?? false;


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


    // ─── Internal ────────────────────────────────────────────────────

    private log(level: LogLevel, tag: string, message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `${timestamp} [${level}] [${tag}] ${message}`;

        // 1. Log to Azure InvocationContext
        this.logToContext(level, formattedMessage);

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


}
