import request from "supertest";
import RedisMock from "ioredis-mock";
import app, { setTemporalClient } from "../src/index";
import { setRedisClient, closeRedisClient } from "../src/redis/client";
import { BestHotel } from "../src/types";

describe("Express API Integration Tests (/api/hotels and /health)", () => {
  let mockRedis: any;

  const mockDelhiHotels: BestHotel[] = [
    { name: "Holtin", price: 5340, supplier: "Supplier B", commissionPct: 20 },
    { name: "Radison", price: 5900, supplier: "Supplier A", commissionPct: 13 },
    { name: "Le Meridien", price: 7800, supplier: "Supplier B", commissionPct: 12 },
    { name: "ITC Grand", price: 8900, supplier: "Supplier B", commissionPct: 15 },
    { name: "Taj Palace", price: 12000, supplier: "Supplier A", commissionPct: 8 },
    { name: "The Oberoi", price: 14200, supplier: "Supplier B", commissionPct: 9 },
  ];

  beforeEach(() => {
    mockRedis = new RedisMock();
    setRedisClient(mockRedis);

    // Mock Temporal client
    const mockWorkflowHandle = {
      result: jest.fn().mockResolvedValue(mockDelhiHotels),
    };

    const mockTemporalClient: any = {
      workflow: {
        start: jest.fn().mockResolvedValue(mockWorkflowHandle),
        list: jest.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            yield { execution: { workflowId: "test-wf" } };
          },
        }),
      },
    };

    setTemporalClient(mockTemporalClient);
  });

  afterEach(async () => {
    await closeRedisClient();
    setTemporalClient(null);
  });

  describe("GET /api/hotels", () => {
    it("should return 400 if city parameter is missing", async () => {
      const res = await request(app).get("/api/hotels");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/city/i);
    });

    it("should return 400 if city parameter is blank or only whitespace", async () => {
      const res = await request(app).get("/api/hotels?city=   ");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/city/i);
    });

    it("should return 400 if city parameter exceeds 100 characters", async () => {
      const longCity = "a".repeat(101);
      const res = await request(app).get(`/api/hotels?city=${longCity}`);
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/100 characters/i);
    });

    it("should return 400 if minPrice is not a valid number", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=invalid");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/minPrice/i);
    });

    it("should return 400 if maxPrice is not a valid number", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&maxPrice=invalid");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/maxPrice/i);
    });

    it("should return 400 if minPrice is negative", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=-100");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/minPrice/i);
    });

    it("should return 400 if maxPrice is negative", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&maxPrice=-500");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/maxPrice/i);
    });

    it("should return 400 if minPrice is strictly greater than maxPrice", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=10000&maxPrice=5000");
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toMatch(/cannot exceed/i);
    });

    it("should start Temporal workflow, save to Redis, and return deduplicated hotels for Delhi", async () => {
      const res = await request(app).get("/api/hotels?city=delhi");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(6);

      // Verify specific deduplication results
      const holtin = res.body.find((h: BestHotel) => h.name === "Holtin");
      expect(holtin).toEqual({
        name: "Holtin",
        price: 5340,
        supplier: "Supplier B",
        commissionPct: 20,
      });

      const radison = res.body.find((h: BestHotel) => h.name === "Radison");
      expect(radison).toEqual({
        name: "Radison",
        price: 5900,
        supplier: "Supplier A",
        commissionPct: 13,
      });

      // Verify data is now cached in Redis
      const cached = await mockRedis.zrange("hotels:delhi", 0, -1);
      expect(cached.length).toBe(6);
    });

    it("should filter hotels by price range using Redis ZRANGEBYSCORE", async () => {
      // First populate Redis cache
      await request(app).get("/api/hotels?city=delhi");

      // Query with price filter [5000, 8000]
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=5000&maxPrice=8000");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.map((h: BestHotel) => h.name)).toEqual([
        "Holtin",
        "Radison",
        "Le Meridien",
      ]);

      res.body.forEach((hotel: BestHotel) => {
        expect(hotel.price).toBeGreaterThanOrEqual(5000);
        expect(hotel.price).toBeLessThanOrEqual(8000);
      });
    });

    it("should filter with only minimum price specified", async () => {
      await request(app).get("/api/hotels?city=delhi");
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=12000");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((h: BestHotel) => h.name)).toEqual(["Taj Palace", "The Oberoi"]);
    });

    it("should filter with only maximum price specified", async () => {
      await request(app).get("/api/hotels?city=delhi");
      const res = await request(app).get("/api/hotels?city=delhi&maxPrice=6000");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((h: BestHotel) => h.name)).toEqual(["Holtin", "Radison"]);
    });

    it("should return empty array when price range matches zero hotels", async () => {
      await request(app).get("/api/hotels?city=delhi");
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=20000&maxPrice=25000");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should handle cache-miss when price filter is queried before city is cached", async () => {
      const res = await request(app).get("/api/hotels?city=delhi&minPrice=10000&maxPrice=15000");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((h: BestHotel) => h.name)).toEqual([
        "Taj Palace",
        "The Oberoi",
      ]);
    });

    it("should return empty array for an unknown city with no hotels", async () => {
      const mockWorkflowHandle = {
        result: jest.fn().mockResolvedValue([]),
      };
      setTemporalClient({
        workflow: {
          start: jest.fn().mockResolvedValue(mockWorkflowHandle),
        },
      } as any);

      const res = await request(app).get("/api/hotels?city=atlantis");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return 500 when workflow execution encounters an unexpected error", async () => {
      setTemporalClient({
        workflow: {
          start: jest.fn().mockRejectedValue(new Error("Temporal gRPC Connection Refused")),
        },
      } as any);

      const res = await request(app).get("/api/hotels?city=delhi");
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("Security Headers & CORS Middleware", () => {
    it("should set standard security headers on responses", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("should handle CORS preflight OPTIONS requests with 204 No Content", async () => {
      const res = await request(app).options("/api/hotels");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
    });

    it("should return 404 for undefined routes", async () => {
      const res = await request(app).get("/api/undefined-endpoint");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /health (Bonus Requirement)", () => {
    it("should return health status for server, suppliers, redis, and temporal", async () => {
      const res = await request(app).get("/health");

      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("checks");
      expect(res.body).toHaveProperty("timestamp");

      const checks = res.body.checks;
      expect(checks).toHaveProperty("server", "healthy");
      expect(checks).toHaveProperty("supplierA");
      expect(checks).toHaveProperty("supplierB");
      expect(checks).toHaveProperty("redis");
      expect(checks).toHaveProperty("temporal");
    });
  });
});
