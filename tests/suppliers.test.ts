import request from "supertest";
import app from "../src/index";
import { SupplierHotel } from "../src/types";

describe("Supplier Mock APIs (/supplierA/hotels and /supplierB/hotels)", () => {
  describe("Supplier A", () => {
    it("should return Delhi hotels when city=delhi is provided", async () => {
      const res = await request(app).get("/supplierA/hotels?city=delhi");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      res.body.forEach((hotel: SupplierHotel) => {
        expect(hotel.city.toLowerCase()).toBe("delhi");
        expect(hotel).toHaveProperty("hotelId");
        expect(hotel).toHaveProperty("name");
        expect(hotel).toHaveProperty("price");
        expect(hotel).toHaveProperty("city");
        expect(hotel).toHaveProperty("commissionPct");
      });
    });

    it("should be case-insensitive for city parameter (e.g. DELHI, Delhi)", async () => {
      const resUpper = await request(app).get("/supplierA/hotels?city=DELHI");
      const resLower = await request(app).get("/supplierA/hotels?city=delhi");
      expect(resUpper.status).toBe(200);
      expect(resUpper.body).toEqual(resLower.body);
    });

    it("should return Mumbai hotels when city=mumbai", async () => {
      const res = await request(app).get("/supplierA/hotels?city=mumbai");
      expect(res.status).toBe(200);
      res.body.forEach((hotel: SupplierHotel) => {
        expect(hotel.city.toLowerCase()).toBe("mumbai");
      });
    });

    it("should return empty array when city is unknown", async () => {
      const res = await request(app).get("/supplierA/hotels?city=atlantis");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return all hotels when no city query parameter is provided", async () => {
      const res = await request(app).get("/supplierA/hotels");
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(10);
    });
  });

  describe("Supplier B", () => {
    it("should return Delhi hotels when city=delhi is provided", async () => {
      const res = await request(app).get("/supplierB/hotels?city=delhi");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      res.body.forEach((hotel: SupplierHotel) => {
        expect(hotel.city.toLowerCase()).toBe("delhi");
        expect(hotel).toHaveProperty("hotelId");
        expect(hotel).toHaveProperty("name");
        expect(hotel).toHaveProperty("price");
        expect(hotel).toHaveProperty("city");
        expect(hotel).toHaveProperty("commissionPct");
      });
    });

    it("should be case-insensitive for city parameter", async () => {
      const resUpper = await request(app).get("/supplierB/hotels?city=DELHI");
      const resLower = await request(app).get("/supplierB/hotels?city=delhi");
      expect(resUpper.status).toBe(200);
      expect(resUpper.body).toEqual(resLower.body);
    });

    it("should return empty array when city is unknown", async () => {
      const res = await request(app).get("/supplierB/hotels?city=unknown_city");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return all hotels when no city query parameter is provided", async () => {
      const res = await request(app).get("/supplierB/hotels");
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(10);
    });
  });

  describe("Supplier Overlaps and Differences", () => {
    it("should contain overlapping hotel names between A and B with varying prices in Delhi", async () => {
      const resA = await request(app).get("/supplierA/hotels?city=delhi");
      const resB = await request(app).get("/supplierB/hotels?city=delhi");

      const namesA = new Set(resA.body.map((h: SupplierHotel) => h.name.toLowerCase()));
      const namesB = new Set(resB.body.map((h: SupplierHotel) => h.name.toLowerCase()));

      const intersection = [...namesA].filter((name) => namesB.has(name));
      // Delhi must have overlapping hotels (e.g. Holtin, Taj Palace, ITC Grand, The Oberoi)
      expect(intersection.length).toBeGreaterThanOrEqual(3);
      expect(intersection).toContain("holtin");
      expect(intersection).toContain("taj palace");

      // Verify that prices for Holtin differ between suppliers
      const holtinA = resA.body.find((h: SupplierHotel) => h.name.toLowerCase() === "holtin");
      const holtinB = resB.body.find((h: SupplierHotel) => h.name.toLowerCase() === "holtin");
      expect(holtinA.price).not.toBe(holtinB.price);
      expect(holtinB.price).toBeLessThan(holtinA.price); // Holtin is cheaper on Supplier B
    });
  });
});
