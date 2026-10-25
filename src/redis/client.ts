/**
 * @file client.ts
 * @description Backward-compatible facade exposing Redis operations from the default repository.
 * 
 * Architecture Role: Facade / Adapter Layer
 * - Provides legacy utility function exports (`getRedisClient`, `saveHotels`, `getHotelsByPriceRange`)
 *   delegating directly to the underlying `defaultHotelRepository`.
 * - Ensures zero breaking changes for existing integration tests or legacy consumers.
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Encapsulates procedural facade wrappers delegating to the
 *   Repository layer.
 */

import Redis from "ioredis";
import { defaultHotelRepository } from "../repositories/RedisHotelRepository";
import { BestHotel } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

/**
 * Retrieves the underlying active Redis client instance.
 * 
 * @returns {Redis} Active ioredis client.
 */
export function getRedisClient(): Redis {
  return defaultHotelRepository.getClient();
}

/**
 * Replaces the active Redis client in the default repository.
 * Useful for mocking during unit and integration test runs.
 * 
 * @param {Redis} client - Mock or alternative Redis client instance.
 */
export function setRedisClient(client: Redis): void {
  logger.debug("Setting custom Redis client on default repository");
  defaultHotelRepository.setClient(client);
}

/**
 * Gracefully shuts down the default repository's Redis connection.
 * 
 * @returns {Promise<void>}
 */
export async function closeRedisClient(): Promise<void> {
  logger.debug("Closing default Redis client connection");
  await defaultHotelRepository.close();
}

/**
 * Persists deduplicated hotel listings into Redis using Sorted Sets and Hashes.
 * 
 * @param {string} city - Target city name.
 * @param {BestHotel[]} hotels - Array of best-priced hotel offers.
 * @returns {Promise<void>}
 */
export async function saveHotels(city: string, hotels: BestHotel[]): Promise<void> {
  return defaultHotelRepository.saveHotels(city, hotels);
}

/**
 * Retrieves hotels within a specified price range using Redis `ZRANGEBYSCORE`.
 * 
 * @param {string} city - Target city name.
 * @param {number} [minPrice=0] - Lower price threshold.
 * @param {number} [maxPrice=Number.MAX_SAFE_INTEGER] - Upper price threshold.
 * @returns {Promise<BestHotel[]>} Filtered hotel array.
 */
export async function getHotelsByPriceRange(
  city: string,
  minPrice = 0,
  maxPrice = Number.MAX_SAFE_INTEGER
): Promise<BestHotel[]> {
  return defaultHotelRepository.getHotelsByPriceRange(city, minPrice, maxPrice);
}

/**
 * Checks Redis connectivity via PING command.
 * 
 * @returns {Promise<boolean>} True if healthy, false otherwise.
 */
export async function redisHealthCheck(): Promise<boolean> {
  return defaultHotelRepository.isHealthy();
}
