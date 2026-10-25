/**
 * @file AppError.ts
 * @description Enterprise Error Handling Hierarchy and Express Error Handling Middleware.
 * Provides custom domain exceptions with HTTP status codes, error codes, and operational flags.
 * 
 * Design Pattern:
 * - Specializes errors into Operational (predictable client / network errors) and Programmer errors.
 * - Standardized JSON error response payload for consistent client consumption.
 * - Centralized Express middleware catching all unhandled exceptions and logging full diagnostic context.
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "../logger";

const logger = createLogger(__filename);

/**
 * Base abstract application error class.
 * All domain and HTTP-level errors inherit from this class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  /**
   * Constructs an AppError.
   * 
   * @param {string} message - Human-readable explanation of the error.
   * @param {number} statusCode - HTTP status code corresponding to the error.
   * @param {string} errorCode - Unique programmatic error identifier (e.g. "VALIDATION_ERROR").
   * @param {boolean} [isOperational=true] - Indicates whether the error is trusted/predictable.
   * @param {unknown} [details] - Optional extra metadata or validation schema failures.
   */
  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    isOperational = true,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.details = details;

    // Capture standard V8 stack trace omitting this constructor from frames
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when client query parameters or request body fail validation requirements (HTTP 400).
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", true, details);
  }
}

/**
 * Thrown when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 404, "NOT_FOUND", true, details);
  }
}

/**
 * Thrown when external supplier APIs (Supplier A or B) return invalid responses or time out (HTTP 502).
 */
export class UpstreamSupplierError extends AppError {
  constructor(supplierName: string, message: string, details?: unknown) {
    super(
      `Upstream supplier '${supplierName}' failed: ${message}`,
      502,
      "UPSTREAM_SUPPLIER_ERROR",
      true,
      details
    );
  }
}

/**
 * Thrown when the Temporal Workflow execution encounters an unexpected failure (HTTP 500).
 */
export class WorkflowExecutionError extends AppError {
  constructor(message: string, details?: unknown) {
    super(
      `Temporal workflow execution failed: ${message}`,
      500,
      "WORKFLOW_EXECUTION_ERROR",
      true,
      details
    );
  }
}

/**
 * Thrown when Redis cache operations fail (HTTP 500).
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(
      `Persistence layer error: ${message}`,
      500,
      "DATABASE_ERROR",
      true,
      details
    );
  }
}

/**
 * Centralized Express Error Handling Middleware.
 * Catches all forwarded errors (`next(err)`), logs them with scoped context,
 * and serializes a clean, standard response payload to the client.
 * 
 * Preserves backwards compatibility with `{ error: string }` expectations.
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const errorCode = isAppError ? err.errorCode : "INTERNAL_SERVER_ERROR";
  const isOperational = isAppError ? err.isOperational : false;

  // Log error with complete context and stack trace
  logger.error("HTTP Request Error caught by central error handler", {
    url: req.originalUrl,
    method: req.method,
    statusCode,
    errorCode,
    isOperational,
    errorMessage: err.message,
    stack: err.stack,
  });

  // Construct structured API error response
  // Note: Maintains top-level `error` string property for seamless client compatibility
  res.status(statusCode).json({
    error: err.message,
    code: errorCode,
    statusCode,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
}
