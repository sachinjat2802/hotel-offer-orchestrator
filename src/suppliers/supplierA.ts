/**
 * @file supplierA.ts
 * @description Mock upstream REST API for Supplier A hotel inventory feed.
 * 
 * Architecture Role: Upstream Mock Supplier (Simulated Partner Integration)
 * - Emulates an external partner API responding to hotel search queries by city.
 * - Intentionally overlaps in hotel names with Supplier B at differing price points
 *   to validate deduplication and lowest-rate selection rules.
 * 
 * Features:
 * - Query parameter filtering by `city` (case-insensitive).
 * - Full inventory fallback when no city parameter is provided.
 * - Scoped logging tagging all incoming supplier requests with `[supplierA.ts]`.
 */

import { Router, Request, Response } from "express";
import { SupplierHotel } from "../types";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

const router = Router();

/**
 * Static mock inventory for Supplier A.
 * Properties intentionally share names with Supplier B (e.g. Holtin, Taj Palace, ITC Grand, The Oberoi)
 * with distinct pricing and commission percentages.
 */
const hotelsA: SupplierHotel[] = [
  { hotelId: "a1",  name: "Holtin",        price: 6000,  city: "delhi",     commissionPct: 10 },
  { hotelId: "a2",  name: "Radison",       price: 5900,  city: "delhi",     commissionPct: 13 },
  { hotelId: "a3",  name: "Taj Palace",    price: 12000, city: "delhi",     commissionPct: 8  },
  { hotelId: "a4",  name: "ITC Grand",     price: 9500,  city: "delhi",     commissionPct: 11 },
  { hotelId: "a5",  name: "The Oberoi",    price: 15000, city: "delhi",     commissionPct: 7  },
  { hotelId: "a6",  name: "Marriott",      price: 7200,  city: "mumbai",    commissionPct: 12 },
  { hotelId: "a7",  name: "Hyatt Regency", price: 8800,  city: "mumbai",    commissionPct: 9  },
  { hotelId: "a8",  name: "Leela",         price: 11000, city: "mumbai",    commissionPct: 10 },
  { hotelId: "a9",  name: "The Lalit",     price: 6500,  city: "bangalore", commissionPct: 14 },
  { hotelId: "a10", name: "Vivanta",       price: 7000,  city: "bangalore", commissionPct: 11 },
];

/**
 * GET /supplierA/hotels?city=<city>
 * 
 * Retrieves hotel listings from Supplier A filtered by city.
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

  logger.debug("Received request on Supplier A mock API", { city: city || "all" });

  // Filter listings by matching lowercase city name, or return all if unconstrained
  const results = city
    ? hotelsA.filter((h) => h.city.toLowerCase() === city)
    : hotelsA;

  logger.info("Supplier A returning hotel listings", {
    city: city || "all",
    count: results.length,
  });

  res.status(200).json(results);
});

export default router;
