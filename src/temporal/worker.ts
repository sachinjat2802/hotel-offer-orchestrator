/**
 * @file worker.ts
 * @description Temporal Worker process bootstrap and task queue listener.
 * 
 * Architecture Role: Temporal Worker Process
 * - Establishes a durable connection to the Temporal cluster via NativeConnection (Rust core).
 * - Registers the `hotel-search` task queue with both workflow definitions and activity implementations.
 * - Polls for and processes workflow tasks and activity executions.
 * 
 * Error Handling Strategy:
 * - Catches fatal unhandled startup errors and logs full stack traces before exiting.
 * - Graceful shutdown handles SIGINT and SIGTERM signals cleanly.
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { createLogger } from "../logger";

// Create scoped logger tagged with this source file
const logger = createLogger(__filename);

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE || "hotel-search";

/**
 * Initializes and starts the Temporal Worker process.
 * 
 * Lifecycle:
 * 1. Connects to the Temporal server using high-performance Rust NativeConnection.
 * 2. Bundles workflows located at `./workflows.ts`.
 * 3. Registers activities exposed from `./activities.ts`.
 * 4. Listens continuously on the configured task queue.
 * 
 * @returns {Promise<void>}
 */
async function run(): Promise<void> {
  logger.info("Initializing Temporal worker process", {
    address: TEMPORAL_ADDRESS,
    taskQueue: TASK_QUEUE,
    namespace: "default",
  });

  // Connect to Temporal gRPC endpoint
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  // Instantiate worker listening to the designated task queue
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  logger.info("Temporal worker successfully started and listening for workflow/activity tasks", {
    taskQueue: TASK_QUEUE,
  });

  // Run the worker (blocks until signal or unhandled error)
  await worker.run();
}

// Global exception boundary for worker bootstrap
run().catch((err: Error) => {
  logger.error("Temporal worker encountered a fatal crash during execution", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
