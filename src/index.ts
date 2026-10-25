/**
 * @file index.ts
 * @description Application Composition Root and Express HTTP Server Bootstrap.
 * 
 * Architecture Role: Composition Root (N-Tier Architecture)
 * - Wires all layers of the dependency injection hierarchy:
 *   1. Persistence Layer: `RedisHotelRepository`
 *   2. Application Layer: `HotelOrchestrationService`
 *   3. Presentation Layer: `HotelController`
 * - Mounts Express middleware, route handlers, and centralized error handling.
 * - Enforces security headers and permissive CORS for cross-origin client integration.
 * - Manages process lifecycle, graceful shutdown, and uncaught exception traps.
 * 
 * SOLID Principles Applied:
 * - Dependency Inversion Principle (DIP): The composition root is the single location
 *   in the application where concrete implementations are instantiated and bound to abstractions.
 * - Single Responsibility Principle (SRP): Focuses exclusively on assembly, routing configuration,
 *   and HTTP server lifecycle management.
 */

import express, { Request, Response } from "express";
import { Client } from "@temporalio/client";
import supplierARouter from "./suppliers/supplierA";
import supplierBRouter from "./suppliers/supplierB";
import { defaultHotelRepository } from "./repositories/RedisHotelRepository";
import { HotelOrchestrationService } from "./services/HotelOrchestrationService";
import { HotelController } from "./controllers/HotelController";
import { errorHandler } from "./errors/AppError";
import { createLogger } from "./logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

const PORT = parseInt(process.env.PORT || "3000", 10);

// ─── Dependency Injection Graph (Composition Root) ──────────────────────────
// 1. Persistence Layer: instantiate concrete Redis repository
// 2. Application Layer: inject repository into orchestration service
export const orchestrationService = new HotelOrchestrationService(defaultHotelRepository);

// 3. Presentation Layer: inject application service into HTTP controller
export const hotelController = new HotelController(orchestrationService);

/**
 * Injects or clears the Temporal Client.
 * Primarily used by unit and integration tests to inject mock Temporal clients.
 * 
 * @param {Client | null} client - Mock or live Temporal Client.
 */
export function setTemporalClient(client: Client | null): void {
  orchestrationService.setTemporalClient(client);
}

// ─── Express App Configuration ──────────────────────────────────────────────
const app = express();

// Parse standard JSON request bodies
app.use(express.json());

// Enterprise Security Headers & CORS Middleware
app.use((req: Request, res: Response, next) => {
  // Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Defend against clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Modern XSS protection header
  res.setHeader("X-XSS-Protection", "0");
  // Permissive CORS to allow frontend evaluations and API clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle browser CORS preflight check
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Request logging middleware for end-to-end HTTP observability
app.use((req: Request, res: Response, next) => {
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.debug("HTTP Request completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

// Mount Mock Supplier Endpoints
app.use("/supplierA", supplierARouter);
app.use("/supplierB", supplierBRouter);

// Mount Business Orchestration & Diagnostic Health Endpoints
app.get("/api/hotels", hotelController.getHotels);
app.get("/health", hotelController.getHealth);

// 404 Route Handler for undefined resources
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: "NOT_FOUND",
  });
});

// Mount Centralized Enterprise Error Handler Middleware
app.use(errorHandler);

// ─── Process Lifecycle & Graceful Shutdown ───────────────────────────────────
// Start HTTP listener only when not invoked in test runners
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    logger.info(`Hotel Offer Orchestrator HTTP Server listening on port ${PORT}`, {
      port: PORT,
      environment: process.env.NODE_ENV || "development",
    });
  });

  // Handle graceful process termination (SIGINT / SIGTERM)
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    server.close(async () => {
      logger.info("Closed Express HTTP server");
      try {
        await defaultHotelRepository.close();
        logger.info("Closed Redis connection");
      } catch (err: any) {
        logger.error("Error closing Redis connection during shutdown", { error: err.message });
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
}

// Trap unhandled promise rejections and uncaught exceptions
process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled Promise Rejection detected", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception encountered in application process", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

export default app;
