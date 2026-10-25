/**
 * @file workflows.ts
 * @description Temporal Workflow definition orchestrating distributed supplier calls and deduplication.
 * 
 * Architecture Role: Workflow Orchestration Layer (Temporal.io)
 * - Defines the deterministic state machine coordinating hotel offer discovery.
 * - Ensures fault-tolerant, durable execution with end-to-end replayability.
 * 
 * Temporal Constraints & Determinism Rules:
 * - This file executes inside Temporal's isolated V8 deterministic workflow sandbox.
 * - No non-deterministic operations (random numbers, date generators, direct HTTP calls) are permitted here.
 * - All side-effects and external I/O are strictly delegated to Activities via `proxyActivities`.
 * 
 * Activity Retry & Timeout Policy:
 * - `startToCloseTimeout`: 15 seconds per activity execution attempt.
 * - `maximumAttempts`: 3 attempts with exponential backoff on transient crashes.
 */

import { proxyActivities } from "@temporalio/workflow";
import type { BestHotel, HotelSearchInput, SupplierHotel } from "../types";

// Configure activity execution proxy with timeouts and retry policies
const { fetchSupplierA, fetchSupplierB, deduplicateHotels } = proxyActivities<{
  fetchSupplierA(baseUrl: string, city: string): Promise<SupplierHotel[]>;
  fetchSupplierB(baseUrl: string, city: string): Promise<SupplierHotel[]>;
  deduplicateHotels(a: SupplierHotel[], b: SupplierHotel[]): Promise<BestHotel[]>;
}>({
  startToCloseTimeout: "15 seconds",
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Orchestrates the end-to-end hotel offer aggregation and deduplication process:
 * 
 * Lifecycle Steps:
 * 1. Parallel Supplier Ingestion:
 *    Triggers `fetchSupplierA` and `fetchSupplierB` concurrently using `Promise.all`.
 *    Halves upstream latency compared to sequential polling.
 * 
 * 2. Fault-Tolerant Resolution:
 *    Activities absorb partial failures and return available listings.
 * 
 * 3. Domain Deduplication:
 *    Dispatches `deduplicateHotels` activity to compare prices, eliminate duplicate
 *    properties, and tag winning suppliers.
 * 
 * 4. Delivery:
 *    Returns the final, price-sorted array of `BestHotel` offers to the workflow client.
 * 
 * @param {HotelSearchInput} input - Workflow input parameters specifying city and API base URL.
 * @returns {Promise<BestHotel[]>} Array of deduplicated best-priced hotel listings.
 */
export async function hotelSearchWorkflow(
  input: HotelSearchInput
): Promise<BestHotel[]> {
  // Step 1: Concurrently dispatch supplier activities to minimize total workflow latency
  const [hotelsA, hotelsB] = await Promise.all([
    fetchSupplierA(input.baseUrl, input.city),
    fetchSupplierB(input.baseUrl, input.city),
  ]);

  // Step 2: Merge overlapping properties, select lowest price per property, and sort ascending
  const bestHotels = await deduplicateHotels(hotelsA, hotelsB);

  // Step 3: Return final result to caller
  return bestHotels;
}
