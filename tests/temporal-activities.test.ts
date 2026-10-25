import axios from "axios";
import {
  fetchSupplierA,
  fetchSupplierB,
  deduplicateHotels,
} from "../src/temporal/activities";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Temporal Activities (Activities & Fault Tolerance)", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("fetchSupplierA", () => {
    it("should fetch hotels from Supplier A endpoint successfully", async () => {
      const mockHotels = [
        { hotelId: "a1", name: "Holtin", price: 6000, city: "delhi", commissionPct: 10 },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockHotels });

      const result = await fetchSupplierA("http://localhost:3000", "delhi");
      expect(result).toEqual(mockHotels);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://localhost:3000/supplierA/hotels?city=delhi",
        { timeout: 5000 }
      );
    });

    it("should return empty array on network failure / 500 error instead of throwing (fault tolerance)", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network Error / Connection Refused"));

      const result = await fetchSupplierA("http://localhost:3000", "delhi");
      // Graceful error handling ensures workflow continues with remaining suppliers
      expect(result).toEqual([]);
    });

    it("should normalize baseUrl by stripping trailing slashes", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      await fetchSupplierA("http://localhost:3000///", "delhi");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://localhost:3000/supplierA/hotels?city=delhi",
        { timeout: 5000 }
      );
    });

    it("should properly URL-encode city parameters with spaces or special characters", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      await fetchSupplierA("http://localhost:3000", "New Delhi");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://localhost:3000/supplierA/hotels?city=New%20Delhi",
        { timeout: 5000 }
      );
    });

    it("should handle non-array unexpected responses from supplier gracefully", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { message: "Internal server error HTML" } as any });

      const result = await fetchSupplierA("http://localhost:3000", "delhi");
      expect(result).toEqual([]);
    });

    it("should handle timeout error (ECONNABORTED) by returning empty array", async () => {
      const timeoutErr: any = new Error("timeout of 5000ms exceeded");
      timeoutErr.code = "ECONNABORTED";
      mockedAxios.get.mockRejectedValueOnce(timeoutErr);

      const result = await fetchSupplierA("http://localhost:3000", "delhi");
      expect(result).toEqual([]);
    });
  });

  describe("fetchSupplierB", () => {
    it("should fetch hotels from Supplier B endpoint successfully", async () => {
      const mockHotels = [
        { hotelId: "b1", name: "Holtin", price: 5340, city: "delhi", commissionPct: 20 },
      ];
      mockedAxios.get.mockResolvedValueOnce({ data: mockHotels });

      const result = await fetchSupplierB("http://localhost:3000", "delhi");
      expect(result).toEqual(mockHotels);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://localhost:3000/supplierB/hotels?city=delhi",
        { timeout: 5000 }
      );
    });

    it("should return empty array on failure instead of throwing", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("503 Service Unavailable"));

      const result = await fetchSupplierB("http://localhost:3000", "delhi");
      expect(result).toEqual([]);
    });

    it("should normalize baseUrl on Supplier B fetch as well", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      await fetchSupplierB("http://localhost:3000/", "mumbai");
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://localhost:3000/supplierB/hotels?city=mumbai",
        { timeout: 5000 }
      );
    });
  });

  describe("Workflow Resilience Scenario: One Supplier Down", () => {
    it("should still produce valid results if Supplier A is down and only Supplier B responds", async () => {
      const hotelsFromA: any[] = [];
      const hotelsFromB = [
        { hotelId: "b1", name: "Holtin", price: 5340, city: "delhi", commissionPct: 20 },
        { hotelId: "b2", name: "Le Meridien", price: 7800, city: "delhi", commissionPct: 12 },
      ];

      const result = await deduplicateHotels(hotelsFromA, hotelsFromB);
      expect(result).toHaveLength(2);
      expect(result.map((h) => h.supplier)).toEqual(["Supplier B", "Supplier B"]);
    });

    it("should still produce valid results if Supplier B is down and only Supplier A responds", async () => {
      const hotelsFromA = [
        { hotelId: "a1", name: "Radison", price: 5900, city: "delhi", commissionPct: 13 },
      ];
      const hotelsFromB: any[] = [];

      const result = await deduplicateHotels(hotelsFromA, hotelsFromB);
      expect(result).toHaveLength(1);
      expect(result[0].supplier).toBe("Supplier A");
    });
  });
});
