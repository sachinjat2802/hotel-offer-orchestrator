/**
 * @file HotelOrchestrationService.ts
 * @description Application Service coordinating the business workflow across Temporal.io and Redis.
 * 
 * Architecture Role: Application Layer (N-Tier Architecture)
 * - Coordinates business use cases: hotel search orchestration, cache management, and upstream health probing.
 * - Bridges the Presentation Layer (Express Controllers) with Domain Logic (HotelDeduplicator),
 *   Distributed Orchestration (Temporal Workflows), and Persistence (Redis Repositories).
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Coordinates business use cases without coupling to HTTP protocols
 *   or low-level Redis socket implementation details.
 * - Dependency Inversion Principle (DIP): Depends strictly on `IHotelRepository` abstraction rather than
 *   a concrete Redis client instance.
 * - Open/Closed Principle (OCP): Caching strategies or workflow runners can be extended or replaced
 *   without altering controller implementations.
 * 
 * Caching & Fallback Strategy:
 * - Fast-path cache lookup: When price boundaries (`minPrice` / `maxPrice`) are supplied, Redis Sorted
 *   Sets are queried in O(log N + M) time. If populated, cache hit is returned directly without initiating
 *   a Temporal workflow.
 * - Cache-aside write-back: On cache miss or non-filtered search, the Temporal workflow is executed and
 *   results are persisted atomically into Redis with a 1-hour TTL.
 * - In-memory Graceful Degradation: If Redis is unavailable or throws during range lookup, the service
 *   automatically falls back to in-memory filtering so the client always receives valid results.
 */

import { Connection, Client } from "@temporalio/client";
import axios from "axios";
import { IHotelRepository } from "../repositories/IHotelRepository";
import { BestHotel, HotelSearchInput, PriceFilterCriteria, HealthCheckResult } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

/**
 * Interface contract defining orchestration service capabilities.
 */
export interface IHotelOrchestrationService {
  /**
   * Discovers, deduplicates, and filters hotels for a specified city.
   *
   * @param {string} city - Target city name (e.g. "delhi").
   * @param {PriceFilterCriteria} [filters] - Optional minPrice and maxPrice range criteria.
   * @returns {Promise<BestHotel[]>} Deduplicated and price-filtered array of hotel offers.
   */
  searchHotels(city: string, filters?: PriceFilterCriteria): Promise<BestHotel[]>;

  /**
   * Performs concurrent health assessment across all downstream dependencies and upstreams.
   *
   * @param {string} baseUrl - Base URL of the API server (used for probing mock supplier endpoints).
   * @returns {Promise<HealthCheckResult>} Comprehensive health status report.
   */
  checkHealth(baseUrl: string): Promise<HealthCheckResult>;
}

/**
 * Concrete implementation of the hotel orchestration service.
 */
export class HotelOrchestrationService implements IHotelOrchestrationService {
  /**
   * Cached instance of the Temporal Client.
   * @private
   */
  private temporalClient: Client | null = null;

  /**
   * Target Temporal gRPC server address (e.g., "temporal:7233" or "localhost:7233").
   * @private
   * @readonly
   */
  private readonly temporalAddress: string;

  /**
   * Temporal task queue name for hotel search workers.
   * @private
   * @readonly
   */
  private readonly taskQueue: string;

  /**
   * Base URL used by Temporal activities to invoke supplier endpoints.
   * @private
   * @readonly
   */
  private readonly baseUrl: string;

  /**
   * Injected hotel repository for cache management.
   * @private
   * @readonly
   */
  private readonly hotelRepository: IHotelRepository;

  /**
   * Constructs the service with required repository and configuration parameters.
   * 
   * @param {IHotelRepository} hotelRepository - Abstract persistence repository for hotel records.
   * @param {string} [temporalAddress] - Temporal gRPC host and port.
   * @param {string} [taskQueue] - Temporal task queue identifier.
   * @param {string} [baseUrl] - Base URL for supplier HTTP calls.
   */
  constructor(
    hotelRepository: IHotelRepository,
    temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233",
    taskQueue = process.env.TEMPORAL_TASK_QUEUE || "hotel-search",
    baseUrl = process.env.BASE_URL || "http://localhost:3000"
  ) {
    this.hotelRepository = hotelRepository;
    this.temporalAddress = temporalAddress;
    this.taskQueue = taskQueue;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Injects or clears the Temporal Client.
   * Essential for unit and integration testing where live Temporal servers are mocked or absent.
   * 
   * @param {Client | null} client - Temporal Client instance or null to reset.
   */
  public setTemporalClient(client: Client | null): void {
    this.temporalClient = client;
    logger.debug("Temporal client explicitly configured in orchestration service", {
      isMocked: client !== null,
    });
  }

  /**
   * Lazily establishes a connection and returns the Temporal Client.
   * 
   * @returns {Promise<Client>} Connected Temporal client instance.
   * @throws {Error} If connection to the Temporal cluster fails.
   */
  public async getTemporalClient(): Promise<Client> {
    if (!this.temporalClient) {
      logger.info("Initializing connection to Temporal server", { address: this.temporalAddress });
      try {
        const connection = await Connection.connect({ address: this.temporalAddress });
        this.temporalClient = new Client({ connection });
        logger.info("Successfully established connection to Temporal server", { address: this.temporalAddress });
      } catch (err: any) {
        logger.error("Failed to connect to Temporal server", {
          address: this.temporalAddress,
          error: err.message,
          stack: err.stack,
        });
        throw err;
      }
    }
    return this.temporalClient;
  }

  /**
   * Executes the full hotel search orchestration:
   * 
   * 1. Cache-first evaluation:
   *    If price filtering is specified, queries the Redis cache first. If cached results exist,
   *    returns them immediately without triggering the heavier Temporal workflow.
   * 
   * 2. Temporal Workflow Execution:
   *    Dispatches `hotelSearchWorkflow` to the Temporal cluster. The workflow:
   *    - Fetches Supplier A and Supplier B concurrently via Temporal Activities.
   *    - Retries transient network failures using an exponential backoff policy.
   *    - Normalizes and deduplicates hotel offers using single-pass Hash Map matching (O(N+M)).
   * 
   * 3. Cache Population (Write-Aside):
   *    Persists the deduplicated listings into Redis (Sorted Set + Hash) with a 5-minute expiration.
   * 
   * 4. Post-filter & Delivery:
   *    Applies requested price boundaries via Redis `ZRANGEBYSCORE` and returns the final listings.
   *    Gracefully falls back to in-memory filtering if Redis is temporarily unreachable.
   * 
   * @param {string} city - Target city name.
   * @param {PriceFilterCriteria} [filters] - Price boundary criteria.
   * @returns {Promise<BestHotel[]>} De-duplicated and filtered hotel offers.
   */
  public async searchHotels(city: string, filters?: PriceFilterCriteria): Promise<BestHotel[]> {
    const normalizedCity = city.toLowerCase().trim();
    const minPrice = filters?.minPrice;
    const maxPrice = filters?.maxPrice;

    // Fast-path: Check Redis if price filter bounds are supplied
    if (minPrice !== undefined || maxPrice !== undefined) {
      try {
        const cached = await this.hotelRepository.getHotelsByPriceRange(
          normalizedCity,
          minPrice ?? 0,
          maxPrice ?? Number.MAX_SAFE_INTEGER
        );

        if (cached.length > 0) {
          logger.info("Serving price-filtered results directly from Redis cache", {
            city: normalizedCity,
            minPrice,
            maxPrice,
            count: cached.length,
          });
          return cached;
        }
      } catch (cacheErr: any) {
        // Cache failures should degrade gracefully and allow workflow execution
        logger.warn("Redis cache read failed; falling back to workflow execution", {
          city: normalizedCity,
          error: cacheErr.message,
        });
      }
    }

    // Distributed Workflow path: Execute resilient Temporal workflow
    const client = await this.getTemporalClient();
    const workflowId = `hotel-search-${normalizedCity}-${Date.now()}`;
    const input: HotelSearchInput = { city: normalizedCity, baseUrl: this.baseUrl };

    logger.info("Dispatching hotelSearchWorkflow to Temporal", {
      workflowId,
      taskQueue: this.taskQueue,
      city: normalizedCity,
    });

    const handle = await client.workflow.start("hotelSearchWorkflow", {
      taskQueue: this.taskQueue,
      workflowId,
      args: [input],
    });

    // Await workflow completion and extract deduplicated best offers
    const bestHotels: BestHotel[] = await handle.result();
    logger.info("Temporal workflow completed successfully", {
      workflowId,
      resultCount: bestHotels.length,
    });

    // Cache-aside: Asynchronously save to Redis for rapid sub-millisecond retrieval
    try {
      await this.hotelRepository.saveHotels(normalizedCity, bestHotels);
      logger.debug("Persisted workflow results to Redis cache", {
        city: normalizedCity,
        count: bestHotels.length,
      });
    } catch (saveErr: any) {
      // Non-fatal: Log warning and continue serving fresh results to client
      logger.warn("Failed to persist workflow results into Redis cache", {
        city: normalizedCity,
        error: saveErr.message,
      });
    }

    // Apply price range filter using Redis sorted set if filters were requested
    if (minPrice !== undefined || maxPrice !== undefined) {
      try {
        return await this.hotelRepository.getHotelsByPriceRange(
          normalizedCity,
          minPrice ?? 0,
          maxPrice ?? Number.MAX_SAFE_INTEGER
        );
      } catch (rangeErr: any) {
        // High resilience: Fallback to in-memory filtering if Redis is down right after workflow execution
        logger.warn("Redis range query failed; falling back to in-memory filter", {
          city: normalizedCity,
          error: rangeErr.message,
        });
        const min = minPrice ?? 0;
        const max = maxPrice ?? Number.MAX_SAFE_INTEGER;
        return bestHotels.filter((h) => h.price >= min && h.price <= max);
      }
    }

    return bestHotels;
  }

  /**
   * Conducts a non-blocking diagnostic health probe across all system dependencies:
   * - Supplier A HTTP endpoint
   * - Supplier B HTTP endpoint
   * - Redis cache connection
   * - Temporal orchestration cluster
   * 
   * Uses `Promise.allSettled` to guarantee that all dependencies are evaluated concurrently
   * and a slow or failing dependency does not abort the remaining checks.
   * 
   * @param {string} baseUrl - Base URL of the API server.
   * @returns {Promise<HealthCheckResult>} Comprehensive composite health assessment.
   */
  public async checkHealth(baseUrl: string): Promise<HealthCheckResult> {
    const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
    const checks: HealthCheckResult["checks"] = {
      server: "healthy",
      supplierA: "unknown",
      supplierB: "unknown",
      redis: "unknown",
      temporal: "unknown",
    };

    logger.debug("Initiating parallel health check across dependencies", { baseUrl: cleanBaseUrl });

    // Execute health checks in parallel to minimize latency
    const [supARes, supBRes, redisRes, temporalRes] = await Promise.allSettled([
      axios.get(`${cleanBaseUrl}/supplierA/hotels?city=delhi`, { timeout: 3000 }),
      axios.get(`${cleanBaseUrl}/supplierB/hotels?city=delhi`, { timeout: 3000 }),
      this.hotelRepository.isHealthy(),
      (async () => {
        const client = await this.getTemporalClient();
        await client.workflowService.getSystemInfo({});
        return true;
      })(),
    ]);

    // Evaluate individual service health status
    checks.supplierA = supARes.status === "fulfilled" && supARes.value.status === 200 ? "healthy" : "unhealthy";
    checks.supplierB = supBRes.status === "fulfilled" && supBRes.value.status === 200 ? "healthy" : "unhealthy";
    checks.redis = redisRes.status === "fulfilled" && redisRes.value === true ? "healthy" : "unhealthy";
    checks.temporal = temporalRes.status === "fulfilled" ? "healthy" : "unhealthy";

    const allHealthy = Object.values(checks).every((v) => v === "healthy");

    logger.info("Health check evaluation completed", {
      status: allHealthy ? "healthy" : "degraded",
      checks,
    });

    return {
      status: allHealthy ? "healthy" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
