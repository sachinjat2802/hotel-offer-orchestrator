/**
 * @file supplierB.ts
 * @description Mock upstream REST API for Supplier B hotel inventory feed.
 * 
 * Architecture Role: Upstream Mock Supplier (Simulated Partner Integration)
 * - Emulates a second external partner API responding to hotel search queries by city.
 * - Provides alternative prices and commission structures for overlapping hotel names,
 *   enabling validation of the lowest-offer deduplication engine.
 * 
 * Features:
 * - Query parameter filtering by `city` (case-insensitive).
 * - Full inventory fallback when no city parameter is provided.
 * - Scoped logging tagging all incoming supplier requests with `[supplierB.ts]`.
 */

import { Router, Request, Response } from "express";
import { SupplierHotel } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

const router = Router();

/**
 * Static mock inventory for Supplier B.
 * Several hotel properties intentionally overlap with Supplier A at lower rates (e.g., Holtin at 5340,
 * ITC Grand at 8900, The Oberoi at 14200) or higher rates (e.g., Taj Palace at 13500) to verify
 * bidirectional comparison correctness.
 */
const hotelsB: SupplierHotel[] = [
  { hotelId: "b1",  name: "Holtin",        price: 5340,  city: "delhi",     commissionPct: 20 },
  { hotelId: "b2",  name: "Taj Palace",    price: 13500, city: "delhi",     commissionPct: 6  },
  { hotelId: "b3",  name: "ITC Grand",     price: 8900,  city: "delhi",     commissionPct: 15 },
  { hotelId: "b4",  name: "Le Meridien",   price: 7800,  city: "delhi",     commissionPct: 12 },
  { hotelId: "b5",  name: "The Oberoi",    price: 14200, city: "delhi",     commissionPct: 9  },
  { hotelId: "b6",  name: "Marriott",      price: 7600,  city: "mumbai",    commissionPct: 10 },
  { hotelId: "b7",  name: "Hyatt Regency", price: 8200,  city: "mumbai",    commissionPct: 11 },
  { hotelId: "b8",  name: "Trident",       price: 9800,  city: "mumbai",    commissionPct: 8  },
  { hotelId: "b9",  name: "Vivanta",       price: 6800,  city: "bangalore", commissionPct: 13 },
  { hotelId: "b10", name: "Park Hyatt",    price: 10200, city: "bangalore", commissionPct: 7  },
];

/**
 * GET /supplierB/hotels?city=<city>
 * 
 * Retrieves hotel listings from Supplier B filtered by city.
 * 
 * Query Parameters:
 * - `city` (string, optional): Target city name. If omitted, returns all inventory.
 * 
 * Response:
 * - 200 OK: Array of `SupplierHotel` objects.
 */
router.get("/hotels", (req: Request, res: Response) => {
  // Extract and normalize city parameter
  const city = (req.query.city as string | undefined)?.toLowerCase().trim();

  logger.debug("Received request on Supplier B mock API", { city: city || "all" });

  // Filter listings by matching lowercase city name, or return all if unconstrained
  const results = city
    ? hotelsB.filter((h) => h.city.toLowerCase() === city)
    : hotelsB;

  logger.info("Supplier B returning hotel listings", {
    city: city || "all",
    count: results.length,
  });

  res.status(200).json(results);
});

export default router;
