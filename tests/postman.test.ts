import fs from "fs";
import path from "path";

describe("Postman Collection Validation", () => {
  const collectionPath = path.join(
    __dirname,
    "../postman/Hotel_Offer_Orchestrator.postman_collection.json"
  );

  it("should exist and be valid JSON", () => {
    expect(fs.existsSync(collectionPath)).toBe(true);
    const raw = fs.readFileSync(collectionPath, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("should conform to Postman Collection v2.1 schema", () => {
    const collection = JSON.parse(fs.readFileSync(collectionPath, "utf-8"));
    expect(collection).toHaveProperty("info");
    expect(collection.info).toHaveProperty("name", "Hotel Offer Orchestrator");
    expect(collection.info.schema).toContain("collection.json");
    expect(collection).toHaveProperty("item");
    expect(Array.isArray(collection.item)).toBe(true);
  });

  it("should contain all required test scenarios across folders", () => {
    const collection = JSON.parse(fs.readFileSync(collectionPath, "utf-8"));

    // Flatten all request items
    const allRequests: any[] = [];
    function collectRequests(items: any[]) {
      for (const item of items) {
        if (item.item) {
          collectRequests(item.item);
        } else if (item.request) {
          allRequests.push(item);
        }
      }
    }
    collectRequests(collection.item);

    const names = allRequests.map((r) => r.name);

    // Verify key test scenarios required by prompt
    expect(names.some((n) => /delhi/i.test(n))).toBe(true);
    expect(names.some((n) => /mumbai/i.test(n))).toBe(true);
    expect(names.some((n) => /price/i.test(n))).toBe(true);
    expect(names.some((n) => /no results/i.test(n))).toBe(true);
    expect(names.some((n) => /missing city/i.test(n))).toBe(true);
    expect(names.some((n) => /health/i.test(n))).toBe(true);
    expect(names.some((n) => /supplier a/i.test(n))).toBe(true);
    expect(names.some((n) => /supplier b/i.test(n))).toBe(true);

    // Verify all requests have automated test scripts
    allRequests.forEach((req) => {
      expect(req).toHaveProperty("event");
      const testEvent = req.event.find((e: any) => e.listen === "test");
      expect(testEvent).toBeDefined();
      expect(testEvent.script.exec.length).toBeGreaterThan(0);
    });
  });
});
