import RedisMock from "ioredis-mock";
import {
  setRedisClient,
  closeRedisClient,
  saveHotels,
  getHotelsByPriceRange,
  redisHealthCheck,
} from "../src/redis/client";
import { BestHotel } from "../src/types";

describe("Redis Storage and Price Filtering (sorted set + hash)", () => {
  let mockRedis: any;

  const sampleHotels: BestHotel[] = [
    { name: "Budget Inn", price: 3000, supplier: "Supplier A", commissionPct: 10 },
    { name: "Holtin", price: 5340, supplier: "Supplier B", commissionPct: 20 },
    { name: "Radison", price: 5900, supplier: "Supplier A", commissionPct: 13 },
    { name: "Le Meridien", price: 7800, supplier: "Supplier B", commissionPct: 12 },
    { name: "The Oberoi", price: 14200, supplier: "Supplier B", commissionPct: 9 },
  ];

  beforeEach(() => {
    mockRedis = new RedisMock();
    setRedisClient(mockRedis);
  });

  afterEach(async () => {
    await closeRedisClient();
  });

  it("should save hotels to Redis sorted-set and hash", async () => {
    await saveHotels("delhi", sampleHotels);

    // Verify sorted set exists and has score
    const zMembers = await mockRedis.zrange("hotels:delhi", 0, -1);
    expect(zMembers).toHaveLength(5);
    expect(zMembers).toContain("Holtin");

    // Verify hash stores JSON data
    const holtinJson = await mockRedis.hget("hotels:delhi:data", "Holtin");
    expect(JSON.parse(holtinJson)).toEqual({
      name: "Holtin",
      price: 5340,
      supplier: "Supplier B",
      commissionPct: 20,
    });
  });

  it("should retrieve all hotels when no price bounds are specified", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi");
    expect(results).toHaveLength(5);
    expect(results[0].name).toBe("Budget Inn");
    expect(results[4].name).toBe("The Oberoi");
  });

  it("should filter hotels by price range [5000, 8000] inside Redis using ZRANGEBYSCORE", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 5000, 8000);

    expect(results).toHaveLength(3);
    const names = results.map((h) => h.name);
    expect(names).toEqual(["Holtin", "Radison", "Le Meridien"]);

    // Verify all prices fall within the specified range
    results.forEach((hotel) => {
      expect(hotel.price).toBeGreaterThanOrEqual(5000);
      expect(hotel.price).toBeLessThanOrEqual(8000);
    });
  });

  it("should filter with only minimum price (e.g. minPrice >= 7000)", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 7000, Number.MAX_SAFE_INTEGER);

    expect(results).toHaveLength(2);
    expect(results.map((h) => h.name)).toEqual(["Le Meridien", "The Oberoi"]);
  });

  it("should filter with only maximum price (e.g. maxPrice <= 5500)", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 0, 5500);

    expect(results).toHaveLength(2);
    expect(results.map((h) => h.name)).toEqual(["Budget Inn", "Holtin"]);
  });

  it("should return empty array when no hotels match the price range", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 20000, 30000);
    expect(results).toEqual([]);
  });

  it("should return empty array when city is not cached in Redis", async () => {
    const results = await getHotelsByPriceRange("mumbai", 1000, 5000);
    expect(results).toEqual([]);
  });

  it("should report healthy in redisHealthCheck when ping succeeds", async () => {
    const healthy = await redisHealthCheck();
    expect(healthy).toBe(true);
  });

  // ─── EXTENDED REDIS EDGE CASES ──────────────────────────────────────────

  it("should filter for an exact single price point (minPrice == maxPrice)", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 5340, 5340);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Holtin");
    expect(results[0].price).toBe(5340);
  });

  it("should return empty array when minPrice == maxPrice has no matching hotel", async () => {
    await saveHotels("delhi", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 5000, 5000);
    expect(results).toEqual([]);
  });

  it("should handle case-insensitive city names and trimming in cache keys", async () => {
    await saveHotels("  DELHI  ", sampleHotels);
    const results = await getHotelsByPriceRange("delhi", 3000, 4000);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Budget Inn");
  });

  it("should gracefully skip corrupted JSON entries in the hash without crashing", async () => {
    await saveHotels("delhi", sampleHotels);

    // Corrupt one entry manually
    await mockRedis.hset("hotels:delhi:data", "Holtin", "{corrupted-json-invalid");

    const results = await getHotelsByPriceRange("delhi", 5000, 8000);

    // Holtin was corrupted, so it should be skipped; Radison & Le Meridien should still be returned
    expect(results).toHaveLength(2);
    expect(results.map((h) => h.name)).toEqual(["Radison", "Le Meridien"]);
  });

  it("should report unhealthy in redisHealthCheck when ping fails", async () => {
    const brokenMock: any = {
      ping: jest.fn().mockRejectedValue(new Error("Connection reset")),
      quit: jest.fn().mockResolvedValue("OK"),
      disconnect: jest.fn(),
    };
    setRedisClient(brokenMock);

    const healthy = await redisHealthCheck();
    expect(healthy).toBe(false);
  });

  it("should handle saving an empty list of hotels without throwing", async () => {
    await expect(saveHotels("emptycity", [])).resolves.not.toThrow();
    const results = await getHotelsByPriceRange("emptycity");
    expect(results).toEqual([]);
  });
});
