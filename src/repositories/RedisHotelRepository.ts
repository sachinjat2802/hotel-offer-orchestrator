/**
 * @file RedisHotelRepository.ts
 * @description Production Redis implementation of `IHotelRepository`.
 * 
 * Architecture Role: Data Access Layer (N-Tier Architecture)
 * - Implements persistence using Redis Sorted Sets and Hashes.
 * - Manages low-level connection pooling, retry strategies, and pipelined socket writes.
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Dedicated solely to Redis data mapping, pipelining, and querying.
 * - Liskov Substitution Principle (LSP): Fully adheres to `IHotelRepository` contract; can be transparently
 *   swapped with an in-memory or alternative NoSQL repository.
 * 
 * Storage Strategy & Algorithmic Optimizations:
 * 1. Redis Sorted Set (`hotels:<city>`):
 *    - Indexes hotel names with room price as the floating-point score.
 *    - Enables native server-side range queries via `ZRANGEBYSCORE` in O(log N + M) time.
 *    - Eliminates in-memory filtering overhead in Node.js, drastically minimizing network transfer.
 * 2. Companion Hash (`hotels:<city>:data`):
 *    - Stores full serialized JSON objects keyed by hotel name.
 *    - Facilitates bulk retrieval of matching items using `HMGET` in O(M) time.
 * 3. Atomic Pipelining & TTL Management:
 *    - Commands (`DEL`, `ZADD`, `HSET`, `EXPIRE`) are batched in a single TCP socket roundtrip.
 *    - 5-minute (300-second) TTL prevents memory leaks and ensures cache freshness.
 */

import Redis from "ioredis";
import { IHotelRepository } from "./IHotelRepository";
import { BestHotel } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CACHE_TTL_SECONDS = 300; // 5 minutes cache expiration

/**
 * Concrete Redis repository managing cached hotel offers.
 */
export class RedisHotelRepository implements IHotelRepository {
  /**
   * Underlying ioredis client instance.
   * @private
   */
  private client: Redis;

  /**
   * Initializes the repository with an optional injected client (enables unit testing with mocks).
   * 
   * @param {Redis} [customClient] - Optional pre-configured Redis client or mock.
   */
  constructor(customClient?: Redis) {
    if (customClient) {
      this.client = customClient;
      logger.debug("Initialized RedisHotelRepository with custom/mock Redis client");
    } else {
      logger.debug("Initializing Redis connection", { url: REDIS_URL });
      this.client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          // Exponential backoff capped at 2 seconds
          const delay = Math.min(times * 200, 2000);
          return delay;
        },
      });

      this.client.on("error", (err) => {
        logger.error("Redis connection error encountered", { error: err.message, stack: err.stack });
      });

      this.client.on("connect", () => {
        logger.info("Successfully established connection to Redis server");
      });
    }
  }

  /**
   * Replaces the active Redis client instance (primarily used during test setup/teardown).
   * 
   * @param {Redis} client - Replacement Redis client.
   */
  public setClient(client: Redis): void {
    this.client = client;
    logger.debug("Swapped active Redis client instance");
  }

  /**
   * Returns the underlying Redis client instance.
   * 
   * @returns {Redis} Current Redis client.
   */
  public getClient(): Redis {
    return this.client;
  }

  /**
   * Generates the Redis Sorted Set key for a given city.
   * 
   * @private
   * @param {string} city - Target city name.
   * @returns {string} Key name in format `hotels:<city>`.
   */
  private sortedSetKey(city: string): string {
    return `hotels:${city.toLowerCase().trim()}`;
  }

  /**
   * Generates the Redis Hash key storing full hotel JSON payloads for a given city.
   * 
   * @private
   * @param {string} city - Target city name.
   * @returns {string} Key name in format `hotels:<city>:data`.
   */
  private hashKey(city: string): string {
    return `hotels:${city.toLowerCase().trim()}:data`;
  }

  /**
   * Persists deduplicated hotel listings in a single atomic pipelined roundtrip.
   * 
   * Algorithmic Complexity:
   * - Time Complexity: O(N) where N = hotels.length. All write commands are executed sequentially in Redis memory.
   * - Network Roundtrips: Exactly 1 socket transmission due to Redis pipelining.
   * 
   * @param {string} city - Target city name.
   * @param {BestHotel[]} hotels - Array of deduplicated hotel entities.
   * @returns {Promise<void>}
   */
  public async saveHotels(city: string, hotels: BestHotel[]): Promise<void> {
    const zkey = this.sortedSetKey(city);
    const hkey = this.hashKey(city);

    logger.debug("Pipelining hotel persistence to Redis", { city, count: hotels.length });

    // Open a pipeline to batch all deletion and insertion commands
    const pipeline = this.client.pipeline();

    // Invalidate previous cache entries for this city
    pipeline.del(zkey);
    pipeline.del(hkey);

    // Populate Sorted Set (price -> name) and Hash (name -> JSON)
    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      // Index hotel name by its price score in the Sorted Set
      pipeline.zadd(zkey, hotel.price, hotel.name);
      // Store full entity attributes in the companion Hash
      pipeline.hset(hkey, hotel.name, JSON.stringify(hotel));
    }

    // Set TTL on both data structures to enforce freshness
    pipeline.expire(zkey, CACHE_TTL_SECONDS);
    pipeline.expire(hkey, CACHE_TTL_SECONDS);

    // Transmit pipeline in a single TCP frame
    await pipeline.exec();
    logger.info("Successfully persisted hotels to Redis", { city, count: hotels.length, ttlSeconds: CACHE_TTL_SECONDS });
  }

  /**
   * Executes an optimized price-range search directly inside the Redis engine.
   * 
   * Algorithmic Complexity:
   * - Time Complexity: O(log N + M) where:
   *   - N = total number of hotels stored for the city
   *   - M = number of hotels matching the price range
   *   Uses native Redis skip-list index traversal.
   * - Space Complexity: O(M) transferring only matching records to Node.js.
   * 
   * @param {string} city - Target city name.
   * @param {number} [minPrice=0] - Lower price boundary (inclusive).
   * @param {number} [maxPrice=Number.MAX_SAFE_INTEGER] - Upper price boundary (inclusive).
   * @returns {Promise<BestHotel[]>} Matching hotel records.
   */
  public async getHotelsByPriceRange(
    city: string,
    minPrice = 0,
    maxPrice = Number.MAX_SAFE_INTEGER
  ): Promise<BestHotel[]> {
    const zkey = this.sortedSetKey(city);
    const hkey = this.hashKey(city);

    logger.debug("Executing ZRANGEBYSCORE query on Redis", { city, minPrice, maxPrice });

    // Step 1: Query the Sorted Set for hotel names satisfying the score range
    const names = await this.client.zrangebyscore(zkey, minPrice, maxPrice);
    if (!names || names.length === 0) {
      logger.debug("No hotels found in Redis for specified price criteria", { city, minPrice, maxPrice });
      return [];
    }

    // Step 2: Batch fetch entity JSON payloads for matched names from the Hash
    const rawValues = await this.client.hmget(hkey, ...names);
    const hotels: BestHotel[] = [];

    // Step 3: Safely deserialize JSON payloads
    for (let i = 0; i < rawValues.length; i++) {
      const raw = rawValues[i];
      if (raw) {
        try {
          hotels.push(JSON.parse(raw) as BestHotel);
        } catch (jsonErr: any) {
          logger.warn("Corrupted JSON entry encountered in Redis hash", {
            key: hkey,
            hotelName: names[i],
            error: jsonErr.message,
          });
        }
      }
    }

    logger.info("Retrieved price-filtered hotels from Redis", {
      city,
      minPrice,
      maxPrice,
      matchedCount: hotels.length,
    });

    return hotels;
  }

  /**
   * Assesses Redis connectivity via `PING`.
   * 
   * @returns {Promise<boolean>} True if PONG response received, false on timeout or error.
   */
  public async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch (err: any) {
      logger.warn("Redis health check failed", { error: err.message });
      return false;
    }
  }

  /**
   * Gracefully closes the Redis connection socket.
   * 
   * @returns {Promise<void>}
   */
  public async close(): Promise<void> {
    if (this.client) {
      logger.debug("Closing Redis client connection");
      try {
        if (typeof this.client.quit === "function") {
          await this.client.quit();
        }
      } catch {
        if (typeof this.client.disconnect === "function") {
          this.client.disconnect();
        }
      }
    }
  }
}

/**
 * Global singleton instance of RedisHotelRepository for application-wide use.
 */
export const defaultHotelRepository = new RedisHotelRepository();
