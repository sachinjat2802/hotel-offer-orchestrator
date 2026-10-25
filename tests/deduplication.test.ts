import { deduplicateHotels } from "../src/temporal/activities";
import { SupplierHotel, BestHotel } from "../src/types";

describe("Hotel Deduplication Logic (deduplicateHotels)", () => {
  it("should select the cheaper offer when a hotel is listed by both suppliers", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Holtin", price: 6000, city: "delhi", commissionPct: 10 },
      { hotelId: "a2", name: "Taj Palace", price: 12000, city: "delhi", commissionPct: 8 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Holtin", price: 5340, city: "delhi", commissionPct: 20 }, // Cheaper
      { hotelId: "b2", name: "Taj Palace", price: 13500, city: "delhi", commissionPct: 6 }, // More expensive
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(2);

    const holtin = result.find((h) => h.name === "Holtin");
    expect(holtin).toEqual({
      name: "Holtin",
      price: 5340,
      supplier: "Supplier B",
      commissionPct: 20,
    });

    const taj = result.find((h) => h.name === "Taj Palace");
    expect(taj).toEqual({
      name: "Taj Palace",
      price: 12000,
      supplier: "Supplier A",
      commissionPct: 8,
    });
  });

  it("should select a hotel if only Supplier A returns it", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Radison", price: 5900, city: "delhi", commissionPct: 13 },
    ];
    const listB: SupplierHotel[] = [];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Radison",
      price: 5900,
      supplier: "Supplier A",
      commissionPct: 13,
    });
  });

  it("should select a hotel if only Supplier B returns it", async () => {
    const listA: SupplierHotel[] = [];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Le Meridien", price: 7800, city: "delhi", commissionPct: 12 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "Le Meridien",
      price: 7800,
      supplier: "Supplier B",
      commissionPct: 12,
    });
  });

  it("should handle case-insensitive hotel names during deduplication", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "holtin", price: 6000, city: "delhi", commissionPct: 10 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "HOLTIN", price: 5340, city: "delhi", commissionPct: 20 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(5340);
    expect(result[0].supplier).toBe("Supplier B");
  });

  it("should sort deduplicated hotels by price ascending", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Expensive Resort", price: 15000, city: "delhi", commissionPct: 5 },
      { hotelId: "a2", name: "Budget Inn", price: 3000, city: "delhi", commissionPct: 15 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Midscale Hotel", price: 7000, city: "delhi", commissionPct: 10 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(3);
    expect(result[0].price).toBe(3000);
    expect(result[1].price).toBe(7000);
    expect(result[2].price).toBe(15000);
  });

  it("should return an empty array if both supplier lists are empty", async () => {
    const result = await deduplicateHotels([], []);
    expect(result).toEqual([]);
  });

  it("should match exact required response schema fields: name, price, supplier, commissionPct", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Test Hotel", price: 5000, city: "delhi", commissionPct: 10 },
    ];
    const result = await deduplicateHotels(listA, []);

    expect(result[0]).toEqual({
      name: "Test Hotel",
      price: 5000,
      supplier: "Supplier A",
      commissionPct: 10,
    });
    // Should NOT leak hotelId or city into final response object
    expect(result[0]).not.toHaveProperty("hotelId");
    expect(result[0]).not.toHaveProperty("city");
  });

  // ─── EXTENDED EDGE CASES ──────────────────────────────────────────────────

  it("should handle tie-breaking when both suppliers offer the exact same price", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Hyatt Regency", price: 8000, city: "mumbai", commissionPct: 10 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Hyatt Regency", price: 8000, city: "mumbai", commissionPct: 12 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Hyatt Regency");
    expect(result[0].price).toBe(8000);
    // Preserves Supplier A deterministically
    expect(result[0].supplier).toBe("Supplier A");
  });

  it("should trim surrounding whitespace from hotel names for collision matching", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "  The Grand Palace  ", price: 9000, city: "delhi", commissionPct: 8 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "The Grand Palace", price: 8500, city: "delhi", commissionPct: 10 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("The Grand Palace");
    expect(result[0].price).toBe(8500);
    expect(result[0].supplier).toBe("Supplier B");
  });

  it("should safely skip corrupted records with null, empty names, or invalid prices", async () => {
    const listA: any[] = [
      null,
      undefined,
      { hotelId: "a1", name: "", price: 5000, city: "delhi" },
      { hotelId: "a2", name: "Valid A", price: 4000, city: "delhi", commissionPct: 10 },
      { hotelId: "a3", name: "Bad Price", price: NaN, city: "delhi" },
      { hotelId: "a4", name: "Negative Price", price: -100, city: "delhi" },
    ];
    const listB: any[] = [
      { hotelId: "b1", name: "Valid B", price: 6000, city: "delhi", commissionPct: 12 },
      { hotelId: "b2", name: "Non-finite Price", price: Infinity, city: "delhi" },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(2);
    expect(result.map((h) => h.name)).toEqual(["Valid A", "Valid B"]);
  });

  it("should handle zero price promotional deals correctly", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Complimentary Stay", price: 0, city: "goa", commissionPct: 0 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Complimentary Stay", price: 500, city: "goa", commissionPct: 10 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(0);
    expect(result[0].supplier).toBe("Supplier A");
  });

  it("should handle large scale inputs efficiently (stress test 2000 hotels)", async () => {
    const listA: SupplierHotel[] = [];
    const listB: SupplierHotel[] = [];

    for (let i = 0; i < 1000; i++) {
      listA.push({
        hotelId: `a_${i}`,
        name: `Hotel ${i}`,
        price: 5000 + i,
        city: "delhi",
        commissionPct: 10,
      });
      listB.push({
        hotelId: `b_${i}`,
        name: `Hotel ${i}`,
        price: 5000 + (1000 - i), // Reverse price
        city: "delhi",
        commissionPct: 15,
      });
    }

    const start = Date.now();
    const result = await deduplicateHotels(listA, listB);
    const duration = Date.now() - start;

    expect(result).toHaveLength(1000);
    // Deduplication of 2000 records should take less than 50ms in O(N+M)
    expect(duration).toBeLessThan(50);
    // Verify sorted ascending
    for (let i = 1; i < result.length; i++) {
      expect(result[i].price).toBeGreaterThanOrEqual(result[i - 1].price);
    }
  });

  it("should maintain stability when all hotels have identical prices", async () => {
    const listA: SupplierHotel[] = [
      { hotelId: "a1", name: "Hotel Alpha", price: 5000, city: "delhi", commissionPct: 10 },
      { hotelId: "a2", name: "Hotel Beta", price: 5000, city: "delhi", commissionPct: 10 },
    ];
    const listB: SupplierHotel[] = [
      { hotelId: "b1", name: "Hotel Gamma", price: 5000, city: "delhi", commissionPct: 10 },
    ];

    const result = await deduplicateHotels(listA, listB);

    expect(result).toHaveLength(3);
    result.forEach((h) => expect(h.price).toBe(5000));
  });
});
