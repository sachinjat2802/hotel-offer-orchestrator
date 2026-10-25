/**
 * @file types.ts
 * @description Core domain entity and contract definitions for the Hotel Offer Orchestrator.
 * Adheres to Interface Segregation Principle with lean, strongly-typed contracts.
 */

/**
 * Raw hotel offer returned by external mock suppliers (Supplier A / Supplier B).
 */
export interface SupplierHotel {
  /** Unique provider-scoped identifier for the hotel */
  hotelId: string;
  /** Name of the hotel property (used for case-insensitive deduplication) */
  name: string;
  /** Quoted room price in local currency (e.g., INR) */
  price: number;
  /** City where the hotel is located (e.g., 'delhi', 'mumbai') */
  city: string;
  /** Partner commission percentage offered by the supplier */
  commissionPct: number;
}

/**
 * Best aggregated offer per unique hotel property after comparative deduplication.
 */
export interface BestHotel {
  /** Hotel property name */
  name: string;
  /** Lowest discovered room price across all responding suppliers */
  price: number;
  /** Name of the winning supplier providing the best rate ('Supplier A' | 'Supplier B') */
  supplier: string;
  /** Commission percentage associated with the selected best offer */
  commissionPct: number;
}

/**
 * Input arguments passed to the Temporal `hotelSearchWorkflow`.
 */
export interface HotelSearchInput {
  /** City name to search and query across suppliers */
  city: string;
  /** Internal HTTP base URL used by Temporal activities to communicate with supplier endpoints */
  baseUrl: string;
}

/**
 * Optional criteria for server-side range queries inside Redis.
 */
export interface PriceFilterCriteria {
  /** Minimum price boundary (inclusive) */
  minPrice?: number;
  /** Maximum price boundary (inclusive) */
  maxPrice?: number;
}

/**
 * Comprehensive health status payload describing system and dependency readiness.
 */
export interface HealthCheckResult {
  /** Overall service status ('healthy' if all dependencies pass, else 'degraded') */
  status: "healthy" | "degraded";
  /** Granular status of each upstream dependency */
  checks: {
    /** Express HTTP application server status */
    server: string;
    /** Supplier A mock API accessibility */
    supplierA: string;
    /** Supplier B mock API accessibility */
    supplierB: string;
    /** Redis cache responsiveness */
    redis: string;
    /** Temporal orchestration cluster connection status */
    temporal: string;
  };
  /** ISO-8601 UTC timestamp of the health check evaluation */
  timestamp: string;
}
