/**
 * @file activities.ts
 * @description Temporal Activity implementations for external supplier communication and data processing.
 * 
 * Architecture Role: Temporal Activity Layer (Integration & Execution)
 * - Encapsulates all non-deterministic operations (external network calls, HTTP timeouts, logging).
 * - Registered with the Temporal Worker and executed durably under workflow supervision.
 * 
 * Fault Tolerance & Resilience Strategy:
 * - Each supplier activity wraps HTTP calls in try/catch blocks. On network failure or upstream 5xx,
 *   it logs diagnostic error metadata and returns an empty array `[]`.
 * - URL normalization removes trailing slashes from baseUrl to prevent double-slash routing issues.
 * - This prevents a single degraded supplier from crashing the entire aggregation workflow,
 *   guaranteeing partial data availability (graceful degradation) for end users.
 * 
 * SOLID Principles Applied:
 * - Single Responsibility Principle (SRP): Each fetch activity interacts with a specific supplier endpoint.
 * - Deduplication is delegated to the domain layer (`defaultDeduplicator`), keeping activities thin adapters.
 */

import axios from "axios";
import { SupplierHotel, BestHotel } from "../types";
import { defaultDeduplicator } from "../services/HotelDeduplicator";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

// Maximum HTTP request timeout to avoid blocking Temporal activity slots
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Normalizes base URL by stripping trailing slashes.
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Temporal Activity: Fetches hotel inventory from Supplier A for a target city.
 * 
 * Resilience:
 * - Normalizes URL formatting to prevent double-slash route errors.
 * - Employs a strict 5000ms HTTP timeout.
 * - Catches all Axios network errors, timeouts, or 5xx HTTP statuses.
 * - Logs the error context with file name and returns an empty array `[]` so the workflow can proceed.
 * 
 * @param {string} baseUrl - Base URL of the API host (e.g. "http://localhost:3000").
 * @param {string} city - Target city name (e.g. "delhi").
 * @returns {Promise<SupplierHotel[]>} Array of hotel listings from Supplier A, or empty array on failure.
 */
export async function fetchSupplierA(
  baseUrl: string,
  city: string
): Promise<SupplierHotel[]> {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const url = `${cleanBase}/supplierA/hotels?city=${encodeURIComponent(city)}`;
  logger.info("Initiating HTTP fetch to Supplier A", { url, city });

  try {
    const response = await axios.get<SupplierHotel[]>(url, { timeout: REQUEST_TIMEOUT_MS });
    const data = response.data;
    logger.info("Successfully fetched hotel listings from Supplier A", { city, count: Array.isArray(data) ? data.length : 0 });
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    // Fault tolerance: Return empty array to allow workflow to succeed with remaining suppliers
    logger.error("Supplier A fetch encountered an error; degrading gracefully", {
      city,
      error: err.message,
      stack: err.stack,
    });
    return [];
  }
}

/**
 * Temporal Activity: Fetches hotel inventory from Supplier B for a target city.
 * 
 * Resilience:
 * - Normalizes URL formatting to prevent double-slash route errors.
 * - Employs a strict 5000ms HTTP timeout.
 * - Catches all Axios network errors, timeouts, or 5xx HTTP statuses.
 * - Logs the error context with file name and returns an empty array `[]` so the workflow can proceed.
 * 
 * @param {string} baseUrl - Base URL of the API host (e.g. "http://localhost:3000").
 * @param {string} city - Target city name (e.g. "delhi").
 * @returns {Promise<SupplierHotel[]>} Array of hotel listings from Supplier B, or empty array on failure.
 */
export async function fetchSupplierB(
  baseUrl: string,
  city: string
): Promise<SupplierHotel[]> {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const url = `${cleanBase}/supplierB/hotels?city=${encodeURIComponent(city)}`;
  logger.info("Initiating HTTP fetch to Supplier B", { url, city });

  try {
    const response = await axios.get<SupplierHotel[]>(url, { timeout: REQUEST_TIMEOUT_MS });
    const data = response.data;
    logger.info("Successfully fetched hotel listings from Supplier B", { city, count: Array.isArray(data) ? data.length : 0 });
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    // Fault tolerance: Return empty array to allow workflow to succeed with remaining suppliers
    logger.error("Supplier B fetch encountered an error; degrading gracefully", {
      city,
      error: err.message,
      stack: err.stack,
    });
    return [];
  }
}

/**
 * Temporal Activity: Deduplicates hotel listings across Supplier A and Supplier B feeds.
 * 
 * Delegates deduplication to the pure domain service `HotelDeduplicator` in O(N + M) time.
 * For each property:
 * - Compares prices from both suppliers.
 * - Selects the lowest-priced offer.
 * - Identifies the winning supplier.
 * 
 * @param {SupplierHotel[]} hotelsA - Hotel inventory from Supplier A.
 * @param {SupplierHotel[]} hotelsB - Hotel inventory from Supplier B.
 * @returns {Promise<BestHotel[]>} Deduplicated listings sorted by price ascending.
 */
export async function deduplicateHotels(
  hotelsA: SupplierHotel[],
  hotelsB: SupplierHotel[]
): Promise<BestHotel[]> {
  logger.debug("Executing hotel deduplication activity", {
    countA: Array.isArray(hotelsA) ? hotelsA.length : 0,
    countB: Array.isArray(hotelsB) ? hotelsB.length : 0,
  });

  // Delegate directly to domain layer deduplication service
  return defaultDeduplicator.deduplicate(
    Array.isArray(hotelsA) ? hotelsA : [],
    Array.isArray(hotelsB) ? hotelsB : []
  );
}
