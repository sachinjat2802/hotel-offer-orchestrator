/**
 * @file IHotelRepository.ts
 * @description Persistence abstraction contract for hotel storage and range querying.
 * 
 * Architecture Role: Data Access Layer Interface (N-Tier Architecture)
 * - Defines the storage boundary for persisting and querying hotel offers.
 * - Isolates the application and domain layers from specific persistence technologies
 *   (Redis, PostgreSQL, MongoDB, in-memory mocks).
 * 
 * SOLID Principles Applied:
 * - Dependency Inversion Principle (DIP): High-level modules (e.g. `HotelOrchestrationService`)
 *   depend on this interface rather than low-level drivers (e.g. `ioredis`).
 * - Interface Segregation Principle (ISP): Contains only focused, cohesive methods needed for
 *   hotel offer storage, range retrieval, and health auditing.
 */

import { BestHotel } from "../types";

/**
 * Interface contract representing persistence operations for deduplicated hotel offers.
 */
export interface IHotelRepository {
  /**
   * Persists a collection of deduplicated hotel offers for a specified city.
   *
   * @param {string} city - Target city identifier (e.g. "delhi").
   * @param {BestHotel[]} hotels - Array of deduplicated hotel entities to store.
   * @returns {Promise<void>} Resolves when persistence is complete.
   */
  saveHotels(city: string, hotels: BestHotel[]): Promise<void>;

  /**
   * Performs an optimized range query to retrieve hotels matching specified price boundaries.
   *
   * @param {string} city - Target city identifier.
   * @param {number} [minPrice] - Lower price threshold (inclusive, defaults to 0).
   * @param {number} [maxPrice] - Upper price threshold (inclusive, defaults to MAX_SAFE_INTEGER).
   * @returns {Promise<BestHotel[]>} Array of hotel records whose price falls within [minPrice, maxPrice].
   */
  getHotelsByPriceRange(city: string, minPrice?: number, maxPrice?: number): Promise<BestHotel[]>;

  /**
   * Audits connection responsiveness and availability of the underlying persistence engine.
   *
   * @returns {Promise<boolean>} True if the database is operational and responsive, false otherwise.
   */
  isHealthy(): Promise<boolean>;
}
