/**
 * @file HotelDeduplicator.ts
 * @description Pure Domain Service responsible for hotel merging, price comparison, and deduplication.
 * 
 * Architecture Role: Domain Service Layer (N-Tier Architecture)
 * - Contains pure business rules for evaluating and comparing overlapping hotel offers.
 * - Stateless and free from external I/O (no direct HTTP, database, or network calls),
 *   making it completely deterministic, testable, and reusable.
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Dedicated exclusively to pricing comparison and property deduplication.
 * - Open/Closed Principle (OCP): Interface-backed (`IHotelDeduplicator`) allows introducing alternative
 *   deduplication strategies (e.g. commission-weighted scoring, loyalty adjustments) without modifying existing callers.
 * - Liskov Substitution Principle (LSP): Any implementation of `IHotelDeduplicator` can replace this default class
 *   without violating behavioral expectations.
 * 
 * Resilience & Defensive Programming:
 * - Validates entity structure, skipping malformed items (missing names, non-finite or negative prices)
 *   to ensure bad upstream feeds never poison downstream pipelines.
 * 
 * Algorithmic Complexity:
 * - Time Complexity: O(N + M + U log U) where:
 *   - N = hotelsA.length
 *   - M = hotelsB.length
 *   - U = unique hotels count (U <= N + M)
 *   Uses a single linear scan with O(1) average-time Hash Map lookups.
 * - Space Complexity: O(U) where U is the number of distinct hotel properties stored in the Hash Map.
 */

import { SupplierHotel, BestHotel } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

/**
 * Interface contract defining the hotel offer deduplication strategy.
 */
export interface IHotelDeduplicator {
  /**
   * Merges hotel listings from two suppliers and selects the best offer per unique property.
   *
   * @param {SupplierHotel[]} hotelsA - List of hotels returned by Supplier A.
   * @param {SupplierHotel[]} hotelsB - List of hotels returned by Supplier B.
   * @returns {BestHotel[]} Array of unique hotels with best prices, sorted by price ascending.
   */
  deduplicate(hotelsA: SupplierHotel[], hotelsB: SupplierHotel[]): BestHotel[];
}

/**
 * Default implementation of `IHotelDeduplicator`.
 * Employs a case-insensitive Hash Map for O(1) matching and selects the lowest price for each property.
 */
export class HotelDeduplicator implements IHotelDeduplicator {
  /**
   * De-duplicates hotels across two supplier feeds:
   * 
   * Algorithmic Steps:
   * 1. Initialize an in-memory Hash Map keyed by the normalized (lowercase) hotel name.
   * 2. Pass 1: Iterate through Supplier A items (O(N)), validating integrity and inserting each property.
   * 3. Pass 2: Iterate through Supplier B items (O(M)). If a property already exists, compare
   *    prices. If Supplier B's price is strictly lower, overwrite the record with Supplier B's offer.
   *    If it doesn't exist, insert it as a new property.
   * 4. Convert the Hash Map values into an array in O(U) time.
   * 5. Sort the resulting list ascending by price in O(U log U) for deterministic, client-friendly presentation.
   * 
   * Defensive Edge Cases Handled:
   * - One supplier returns an empty list: all items from the other supplier are preserved.
   * - Both suppliers return empty lists: an empty array is returned.
   * - Identical prices: the existing entry (Supplier A) is preserved deterministically.
   * - Case differences in names ("Holtin" vs "holtin"): normalized via `toLowerCase().trim()` for correct collision.
   * - Corrupt data: ignores entries with empty names or non-finite/negative prices.
   * 
   * @param {SupplierHotel[]} hotelsA - Hotel offers from Supplier A.
   * @param {SupplierHotel[]} hotelsB - Hotel offers from Supplier B.
   * @returns {BestHotel[]} Array of deduplicated best-price hotel listings.
   */
  public deduplicate(hotelsA: SupplierHotel[], hotelsB: SupplierHotel[]): BestHotel[] {
    logger.debug("Starting hotel deduplication algorithm", {
      supplierACount: hotelsA.length,
      supplierBCount: hotelsB.length,
    });

    // In-memory Hash Map indexed by lowercase hotel name for O(1) amortized lookup & insertion
    const bestMap = new Map<string, BestHotel>();

    // Pass 1: Index all valid properties from Supplier A (Time: O(N), Space: O(N))
    for (let i = 0; i < hotelsA.length; i++) {
      const hotel = hotelsA[i];
      // Defensive guard against null/undefined or corrupted records
      if (!hotel || !hotel.name || typeof hotel.price !== "number" || !Number.isFinite(hotel.price) || hotel.price < 0) {
        continue;
      }

      // Normalize name to lowercase to prevent duplicate entries caused by casing discrepancies
      const key = hotel.name.toLowerCase().trim();
      if (!key) continue;

      bestMap.set(key, {
        name: hotel.name.trim(),
        price: hotel.price,
        supplier: "Supplier A",
        commissionPct: typeof hotel.commissionPct === "number" ? hotel.commissionPct : 0,
      });
    }

    // Pass 2: Compare and merge properties from Supplier B (Time: O(M), Space: O(1) per update)
    for (let i = 0; i < hotelsB.length; i++) {
      const hotel = hotelsB[i];
      // Defensive guard against corrupted records
      if (!hotel || !hotel.name || typeof hotel.price !== "number" || !Number.isFinite(hotel.price) || hotel.price < 0) {
        continue;
      }

      const key = hotel.name.toLowerCase().trim();
      if (!key) continue;

      const existing = bestMap.get(key);

      // Decision Rule:
      // - If hotel was not found in Supplier A, insert Supplier B's offer.
      // - If hotel exists but Supplier B offers a strictly lower price, update to Supplier B.
      // - If existing price is lower or equal, retain Supplier A.
      if (!existing || hotel.price < existing.price) {
        bestMap.set(key, {
          name: hotel.name.trim(),
          price: hotel.price,
          supplier: "Supplier B",
          commissionPct: typeof hotel.commissionPct === "number" ? hotel.commissionPct : 0,
        });
      }
    }

    // Convert map values to array (Time: O(U))
    const result: BestHotel[] = Array.from(bestMap.values());

    // Deterministically sort results by price ascending (Time: O(U log U))
    result.sort((a, b) => a.price - b.price);

    logger.info("Hotel deduplication successfully finished", {
      totalInputOffers: hotelsA.length + hotelsB.length,
      uniqueProperties: result.length,
    });

    return result;
  }
}

/**
 * Pre-instantiated singleton instance of the default HotelDeduplicator for zero-allocation reuse.
 */
export const defaultDeduplicator = new HotelDeduplicator();
