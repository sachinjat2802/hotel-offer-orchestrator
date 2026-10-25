/**
 * @file HotelController.ts
 * @description HTTP Presentation Layer Controller for the Hotel Offer Orchestrator.
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Responsible solely for HTTP request handling, parameter
 *   validation, status codes, delegation to the application service, and HTTP response formatting.
 * - Dependency Inversion Principle (DIP): Depends exclusively on the abstraction `IHotelOrchestrationService`,
 *   enabling seamless unit testing and mocking without coupling to concrete implementations.
 * 
 * Error Handling & Security Strategy:
 * - Input Sanitization: Rejects invalid or excessively long city inputs to prevent injection attacks or ReDoS.
 * - Number Bounds Checking: Ensures minPrice/maxPrice are finite, non-negative numbers within safe integer limits.
 * - Clear Error Semantics: Distinguishes between 400 Bad Request, 503 Service Unavailable, and 500 Internal Error.
 * - Scoped Logging: Tags all log entries with `[HotelController.ts]`.
 */

import { Request, Response, NextFunction } from "express";
import { IHotelOrchestrationService } from "../services/HotelOrchestrationService";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

// Maximum allowable characters for city name to protect against memory exhaustion
const MAX_CITY_LENGTH = 100;

/**
 * Controller class managing HTTP endpoints for hotel search orchestration and system health.
 */
export class HotelController {
  /**
   * Injected application orchestration service.
   * @private
   * @readonly
   */
  private readonly orchestrationService: IHotelOrchestrationService;

  /**
   * Initializes the controller with an injected orchestration service.
   * 
   * @param {IHotelOrchestrationService} orchestrationService - Service implementing hotel discovery workflows.
   */
  constructor(orchestrationService: IHotelOrchestrationService) {
    this.orchestrationService = orchestrationService;
  }

  /**
   * Handles GET /api/hotels
   * 
   * Discovers and returns the best hotel offers for a target city with optional price range filtering.
   * 
   * Query Parameters:
   * - `city` (string, required): Target city name (e.g., "delhi", "mumbai", "bangalore").
   * - `minPrice` (number, optional): Lower bound price filter in INR.
   * - `maxPrice` (number, optional): Upper bound price filter in INR.
   * 
   * @param {Request} req - Express HTTP request object.
   * @param {Response} res - Express HTTP response object.
   * @param {NextFunction} [next] - Optional Express next middleware callback.
   * @returns {Promise<void>}
   */
  public getHotels = async (req: Request, res: Response, next?: NextFunction): Promise<void> => {
    // Extract and normalize the target city parameter
    const rawCity = req.query.city;
    if (typeof rawCity !== "string" || !rawCity.trim()) {
      logger.warn("Validation failure: 'city' query parameter missing or blank", { query: req.query });
      res.status(400).json({ error: "Query parameter 'city' is required." });
      return;
    }

    const city = rawCity.toLowerCase().trim();

    // Guard against excessively long input strings
    if (city.length > MAX_CITY_LENGTH) {
      logger.warn("Validation failure: 'city' parameter exceeds maximum allowed length", { length: city.length });
      res.status(400).json({ error: `Query parameter 'city' must not exceed ${MAX_CITY_LENGTH} characters.` });
      return;
    }

    // Parse optional price range filters
    const minPriceRaw = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPriceRaw = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;

    // Validate that minPrice is a valid non-negative finite number if supplied
    if (minPriceRaw !== undefined && (!Number.isFinite(minPriceRaw) || minPriceRaw < 0)) {
      logger.warn("Validation failure: 'minPrice' is not a valid non-negative number", { minPrice: req.query.minPrice });
      res.status(400).json({ error: "Query parameter 'minPrice' must be a valid number." });
      return;
    }

    // Validate that maxPrice is a valid non-negative finite number if supplied
    if (maxPriceRaw !== undefined && (!Number.isFinite(maxPriceRaw) || maxPriceRaw < 0)) {
      logger.warn("Validation failure: 'maxPrice' is not a valid non-negative number", { maxPrice: req.query.maxPrice });
      res.status(400).json({ error: "Query parameter 'maxPrice' must be a valid number." });
      return;
    }

    // Validate range consistency: minPrice cannot exceed maxPrice
    if (minPriceRaw !== undefined && maxPriceRaw !== undefined && minPriceRaw > maxPriceRaw) {
      logger.warn("Validation failure: minPrice exceeds maxPrice", { minPrice: minPriceRaw, maxPrice: maxPriceRaw });
      res.status(400).json({ error: "Query parameter 'minPrice' cannot exceed 'maxPrice'." });
      return;
    }

    try {
      logger.debug("Executing hotel search request", { city, minPrice: minPriceRaw, maxPrice: maxPriceRaw });

      // Delegate business orchestration to the application layer
      const hotels = await this.orchestrationService.searchHotels(city, {
        minPrice: minPriceRaw,
        maxPrice: maxPriceRaw,
      });

      logger.info("Hotel search successfully fulfilled", {
        city,
        returnedCount: hotels.length,
        priceFilters: { minPrice: minPriceRaw, maxPrice: maxPriceRaw },
      });

      res.status(200).json(hotels);
    } catch (err: any) {
      logger.error("Unexpected error in getHotels controller", {
        city,
        error: err.message,
        stack: err.stack,
      });

      if (next) {
        next(err);
      } else {
        res.status(500).json({ error: "Internal server error", details: err.message });
      }
    }
  };

  /**
   * Handles GET /health
   * 
   * Performs an end-to-end composite health assessment checking:
   * - Redis cache connectivity (via PING roundtrip).
   * - Temporal orchestration cluster readiness (via gRPC client connection).
   * - Upstream mock suppliers (Supplier A and Supplier B HTTP responsiveness).
   * 
   * @param {Request} req - Express HTTP request object.
   * @param {Response} res - Express HTTP response object.
   * @returns {Promise<void>}
   */
  public getHealth = async (req: Request, res: Response): Promise<void> => {
    // Resolve base URL for self-referencing supplier mock endpoints
    const port = parseInt(process.env.PORT || "3000", 10);
    const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, "");

    try {
      logger.debug("Executing system health check", { baseUrl });
      const health = await this.orchestrationService.checkHealth(baseUrl);

      // Return 200 when fully healthy, otherwise 503 to signal load balancers / orchestrators
      const httpStatus = health.status === "healthy" ? 200 : 503;
      res.status(httpStatus).json(health);
    } catch (err: any) {
      logger.error("Health check execution failed", { error: err.message, stack: err.stack });
      res.status(503).json({
        status: "degraded",
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
