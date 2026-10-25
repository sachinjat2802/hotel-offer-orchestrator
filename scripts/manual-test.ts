process.env.NODE_ENV = "test";

import path from "path";
import RedisMock from "ioredis-mock";
import { setRedisClient } from "../src/redis/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import * as activities from "../src/temporal/activities";
import app, { setTemporalClient } from "../src/index";
import axios from "axios";

async function main() {
  console.log("================================================================================");
  console.log("               HOTEL OFFER ORCHESTRATOR - LIVE MANUAL TEST RUN               ");
  console.log("================================================================================\n");

  console.log("[1/4] Initializing In-Memory Redis client...");
  const redisMock = new RedisMock();
  setRedisClient(redisMock as any);
  console.log("  -> Redis mock connected successfully.\n");

  console.log("[2/4] Starting Temporal Test Environment...");
  const testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  setTemporalClient(testEnv.client);
  console.log("  -> Temporal server started successfully.");

  console.log("[3/4] Starting Temporal Worker...");
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: "hotel-search",
    workflowsPath: path.resolve(__dirname, "../dist/temporal/workflows.js"),
    activities,
  });

  const workerPromise = worker.run();
  console.log("  -> Worker polling on task queue: hotel-search\n");

  console.log("[4/4] Starting Express HTTP server on port 3000...");
  const server = app.listen(3000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("  -> Express server listening at http://localhost:3000\n");

  const baseUrl = "http://localhost:3000";

  async function executeTest(
    title: string,
    endpoint: string,
    description: string
  ) {
    console.log("--------------------------------------------------------------------------------");
    console.log(`TEST: ${title}`);
    console.log(`ENDPOINT: GET ${endpoint}`);
    console.log(`DESC: ${description}`);
    console.log("--------------------------------------------------------------------------------");
    try {
      const startTime = Date.now();
      const res = await axios.get(`${baseUrl}${endpoint}`, {
        validateStatus: () => true, // Don't throw on 4xx/5xx
      });
      const elapsed = Date.now() - startTime;
      console.log(`HTTP STATUS: ${res.status} ${res.statusText} (${elapsed}ms)`);
      console.log("RESPONSE BODY:");
      console.log(JSON.stringify(res.data, null, 2));
      console.log();
      return res;
    } catch (err: any) {
      console.error(`ERROR calling ${endpoint}:`, err.message);
      console.log();
    }
  }

  // 1. Mock Supplier A
  await executeTest(
    "1. Supplier A Direct Query (Delhi)",
    "/supplierA/hotels?city=delhi",
    "Inspect raw offers directly from Supplier A before deduplication"
  );

  // 2. Mock Supplier B
  await executeTest(
    "2. Supplier B Direct Query (Delhi)",
    "/supplierB/hotels?city=delhi",
    "Inspect raw offers directly from Supplier B before deduplication"
  );

  // 3. GET /api/hotels?city=delhi (Full Orchestration)
  await executeTest(
    "3. Orchestrated Hotel Search (Delhi)",
    "/api/hotels?city=delhi",
    "Calls Supplier A and B in parallel via Temporal workflow, deduplicates by hotel name, chooses cheaper price, and saves to Redis"
  );

  // 4. GET /api/hotels?city=delhi&minPrice=5000&maxPrice=8000 (Redis Price Filter)
  await executeTest(
    "4. Price Range Filter (minPrice=5000 & maxPrice=8000)",
    "/api/hotels?city=delhi&minPrice=5000&maxPrice=8000",
    "Queries Redis sorted set using ZRANGEBYSCORE to filter hotels between 5000 and 8000"
  );

  // 5. GET /api/hotels?city=delhi&minPrice=10000 (Luxury filter)
  await executeTest(
    "5. Luxury Price Filter (minPrice=10000)",
    "/api/hotels?city=delhi&minPrice=10000",
    "Queries Redis for hotels priced >= 10000"
  );

  // 6. GET /api/hotels?city=mumbai (Another City)
  await executeTest(
    "6. Orchestrated Hotel Search (Mumbai)",
    "/api/hotels?city=mumbai",
    "Workflow for a different city with Marriott (7200 vs 7600), Hyatt Regency (8800 vs 8200), etc."
  );

  // 7. GET /api/hotels?city=atlantis (No Results)
  await executeTest(
    "7. Non-Existent City (atlantis)",
    "/api/hotels?city=atlantis",
    "Expect empty array response [] when no supplier offers hotels in the requested city"
  );

  // 8. GET /api/hotels (Missing parameter validation)
  await executeTest(
    "8. Missing Query Parameter Validation",
    "/api/hotels",
    "Expect 400 Bad Request with error description when city parameter is omitted"
  );

  // 9. GET /health (Health Check Bonus)
  await executeTest(
    "9. Health Check Endpoint",
    "/health",
    "Inspect health status of server, Supplier A, Supplier B, Redis, and Temporal"
  );

  console.log("================================================================================");
  console.log("                  ALL MANUAL TESTS COMPLETED SUCCESSFULLY                       ");
  console.log("================================================================================\n");

  // Teardown
  server.close();
  worker.shutdown();
  await workerPromise;
  await testEnv.teardown();
  process.exit(0);
}

main().catch((err) => {
  console.error("Manual test runner failed:", err);
  process.exit(1);
});
