# Hotel Offer Orchestrator

> High-throughput, distributed Hotel Offer Orchestrator engineered with **Node.js (TypeScript)**, **Express**, **Temporal.io**, **Redis**, and **Docker Compose**.

[![CI](https://github.com/sachinjat2802/hotel-offer-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/sachinjat2802/hotel-offer-orchestrator/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green?logo=node.js)](https://nodejs.org/)
[![Temporal](https://img.shields.io/badge/Temporal.io-1.24-black?logo=temporal)](https://temporal.io/)
[![Redis](https://img.shields.io/badge/Redis-7.x-red?logo=redis)](https://redis.io/)
[![Docker Compose](https://img.shields.io/badge/Docker_Compose-Multi--Container-2496ED?logo=docker)](https://www.docker.com/)
[![Tests](https://img.shields.io/badge/Tests-71%2F71_Passing-brightgreen?logo=jest)](https://jestjs.io/)

---

## 📋 Table of Contents
- [Architecture & N-Tier Design](#-architecture--n-tier-design)
- [Algorithmic Complexity & Optimization](#-algorithmic-complexity--optimization)
- [Enterprise Logging & Error Handling](#-enterprise-logging--error-handling)
- [Prerequisites](#-prerequisites)
- [Setup & Run Guide](#-setup--run-guide)
  - [Method 1: Quickstart with Docker Compose (Recommended)](#method-1-quickstart-with-docker-compose-recommended)
  - [Method 2: Local Development Setup (Manual)](#method-2-local-development-setup-manual)
- [API Reference & Curl Examples](#-api-reference--curl-examples)
- [Automated Test Suite](#-automated-test-suite)
- [Postman Collection](#-postman-collection)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Submission Info](#-submission-info)

---

## 🏛️ Architecture & N-Tier Design

The system implements a decoupled **N-Tier Layered Architecture** adhering strictly to **SOLID design principles**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                              │
│  • HotelController: Input validation, sanitization, HTTP responses     │
│  • Supplier Routers: Mock Supplier A & B inventory endpoints           │
│  • Security Middleware: CORS, X-Content-Type-Options, Frame-Options    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Delegates via IHotelOrchestrationService)
┌───────────────────────────────────▼────────────────────────────────────┐
│                        Application Layer                               │
│  • HotelOrchestrationService: Coordinates Temporal workflows,          │
│    fast-path Redis cache-aside, in-memory fallbacks, and health probes │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          │ (Orchestration Engine)                            │ (Repository Interface)
┌─────────▼──────────────────────────┐      ┌─────────────────▼──────────┐
│      Temporal Workflow Layer       │      │     Persistence Layer      │
│  • hotelSearchWorkflow (State)     │      │  • IHotelRepository        │
│  • Parallel Activities (A & B)     │      │  • RedisHotelRepository    │
│  • Fault-Tolerant Supplier Fetch   │      │    - Sorted Set: Score=Price│
│  • Domain HotelDeduplicator        │      │    - Hash: JSON Payload    │
└────────────────────────────────────┘      └────────────────────────────┘
```

### SOLID Principles Breakdown

| Principle | Implementation in Codebase |
|---|---|
| **Single Responsibility (SRP)** | • `HotelController`: Focuses exclusively on HTTP extraction, query parsing, and status codes.<br>• `HotelOrchestrationService`: Manages business workflow coordination.<br>• `HotelDeduplicator`: Stateless domain logic for price comparison.<br>• `RedisHotelRepository`: Exclusively manages Redis pipelining and data mapping. |
| **Open/Closed (OCP)** | Storage engines implement `IHotelRepository` and deduplicators implement `IHotelDeduplicator`. New storage backends (e.g. Postgres, DynamoDB) or weighted ranking strategies can be added without modifying controllers or workflows. |
| **Liskov Substitution (LSP)** | Repositories and services strictly honor their TypeScript contracts (`IHotelRepository`, `IHotelDeduplicator`) and can be substituted without side-effects. |
| **Interface Segregation (ISP)** | Narrow, highly cohesive contracts (`IHotelRepository`, `IHotelOrchestrationService`, `IHotelDeduplicator`) avoiding monolithic or bloated interfaces. |
| **Dependency Inversion (DIP)** | High-level modules depend solely on abstractions. Concrete dependencies are instantiated and wired once in `src/index.ts` (Composition Root). |

---

## ⚡ Algorithmic Complexity & Optimization

| Operation | Time Complexity | Space Complexity | Engineering Decision |
|---|---|---|---|
| **Supplier Ingestion** | $\mathcal{O}(1)$ network | $\mathcal{O}(N)$ memory | Parallel HTTP fetching (`Promise.all`) with 5s timeout & graceful degradation fallback. |
| **Deduplication (`HotelDeduplicator`)** | $\mathcal{O}(N + M)$ | $\mathcal{O}(U)$ | Single-pass Hash Map matching ($N, M$ = supplier counts, $U$ = unique hotels $\le N + M$). |
| **Output Ordering** | $\mathcal{O}(U \log U)$ | $\mathcal{O}(U)$ | Deterministic ascending sort by price for client usability. |
| **Redis Cache Persistence** | $\mathcal{O}(U)$ | $\mathcal{O}(U)$ | Batched atomic pipelining (`DEL` + `ZADD` + `HSET` + `EXPIRE`) executed in a single network socket frame. |
| **Price Filtering (`minPrice`/`maxPrice`)** | $\mathcal{O}(\log U + K)$ | $\mathcal{O}(K)$ | **In-Redis Native Filtering**: `ZRANGEBYSCORE` filters elements on the Redis server skip-list. Node.js only downloads the $K$ matching records, reducing memory and network load. |

---

## 🛡️ Enterprise Logging & Error Handling

- **Scoped File-Origin Logging**: Every log entry is tagged with its source file name (e.g., `[HotelController.ts]`, `[HotelOrchestrationService.ts]`, `[RedisHotelRepository.ts]`) via `createLogger(__filename)`.
- **Environment-Aware Formatting**:
  - **Production**: Structured JSON logs (`timestamp`, `level`, `file`, `service`, `message`, `stack`, `meta`).
  - **Development / Test**: High-visibility colorized console strings with formatted metadata.
- **Enterprise Error Hierarchy**:
  - `AppError`: Base application error with HTTP status codes and operational flags.
  - `ValidationError` (400), `NotFoundError` (404), `UpstreamSupplierError` (502), `DatabaseError` (500).
  - Centralized Express error middleware serializes standard error payloads while protecting sensitive internal traces.

---

## 📦 Prerequisites

Ensure you have the following installed on your system:
- [Git](https://git-scm.com/) (v2.x or later)
- [Docker & Docker Compose](https://www.docker.com/products/docker-desktop/) (Docker Desktop v4.x+)
- [Node.js 20 LTS](https://nodejs.org/) & `npm` (Required only if running tests locally or outside Docker)

---

## 🚀 Setup & Run Guide

### Method 1: Quickstart with Docker Compose (Recommended)

This spins up the complete microservice ecosystem:
- **Express API Server** (`hotel-api`: port 3000)
- **Temporal Worker** (`hotel-worker`)
- **Temporal Server** (`temporal`: port 7233)
- **Temporal Web UI** (`temporal-ui`: port 8080)
- **Redis Cache** (`redis`: port 6379)
- **Temporal Postgres Database** (`temporal-postgres`: port 5432)

#### Step 1: Clone Repository
```bash
git clone https://github.com/sachinjat2802/hotel-offer-orchestrator.git
cd hotel-offer-orchestrator
```

#### Step 2: Build and Start Containers
```bash
docker compose up -d --build
```

#### Step 3: Verify Container Health
```bash
docker compose ps
```
All containers should display `Up` or `Up (healthy)`.

#### Step 4: Verify Live Endpoint
```bash
# Query best hotel offers for Delhi
curl "http://localhost:3000/api/hotels?city=delhi"

# Query price-filtered hotels
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=6000&maxPrice=12000"

# Multi-dependency health check
curl "http://localhost:3000/health"
```

#### Step 5: View Temporal Workflows in Real Time
Open your browser to:
👉 **[http://localhost:8080](http://localhost:8080)**  
You can view the execution history, activity inputs/outputs, and timelines for every `hotelSearchWorkflow`.

---

### Method 2: Local Development Setup (Manual)

If you prefer running Node.js directly on your host machine:

#### Step 1: Install Dependencies
```bash
npm install
```

#### Step 2: Start Redis & Temporal Server
Ensure Redis and Temporal are running locally, or use Docker for dependencies:
```bash
docker compose up -d redis temporal postgres temporal-ui
```

#### Step 3: Run the Temporal Worker
In a dedicated terminal:
```bash
npm run worker
```

#### Step 4: Start the Express API Server
In a second terminal:
```bash
npm run dev
# Or production build:
npm run build && npm start
```

---

## 📖 API Reference & Curl Examples

### 1. Discover Best Hotel Offers
`GET /api/hotels?city=<city>`

Deduplicates hotel feeds across Supplier A and Supplier B, selecting the cheapest rate for each property.

**Request:**
```bash
curl -X GET "http://localhost:3000/api/hotels?city=delhi"
```

**Response (200 OK):**
```json
[
  {
    "name": "Holtin",
    "price": 5340,
    "supplier": "Supplier B",
    "commissionPct": 20
  },
  {
    "name": "Radison",
    "price": 5900,
    "supplier": "Supplier A",
    "commissionPct": 13
  },
  {
    "name": "Le Meridien",
    "price": 7800,
    "supplier": "Supplier B",
    "commissionPct": 12
  },
  {
    "name": "ITC Grand",
    "price": 8900,
    "supplier": "Supplier B",
    "commissionPct": 15
  },
  {
    "name": "Taj Palace",
    "price": 12000,
    "supplier": "Supplier A",
    "commissionPct": 8
  },
  {
    "name": "The Oberoi",
    "price": 14200,
    "supplier": "Supplier B",
    "commissionPct": 9
  }
]
```

---

### 2. Price Range Filtering (Redis-Native)
`GET /api/hotels?city=<city>&minPrice=<min>&maxPrice=<max>`

Filters properties server-side using Redis `ZRANGEBYSCORE` in $\mathcal{O}(\log N + K)$ time.

**Request:**
```bash
curl -X GET "http://localhost:3000/api/hotels?city=delhi&minPrice=6000&maxPrice=10000"
```

**Response (200 OK):**
```json
[
  {
    "name": "Le Meridien",
    "price": 7800,
    "supplier": "Supplier B",
    "commissionPct": 12
  },
  {
    "name": "ITC Grand",
    "price": 8900,
    "supplier": "Supplier B",
    "commissionPct": 15
  }
]
```

---

### 3. System Diagnostic Health Probe
`GET /health`

Performs concurrent health assessments across the Express server, Supplier A, Supplier B, Redis, and Temporal.

**Request:**
```bash
curl -X GET "http://localhost:3000/health"
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "checks": {
    "server": "healthy",
    "supplierA": "healthy",
    "supplierB": "healthy",
    "redis": "healthy",
    "temporal": "healthy"
  },
  "timestamp": "2026-10-25T14:45:00.123Z"
}
```

---

### 4. Mock Supplier Endpoints
- `GET /supplierA/hotels?city=delhi`
- `GET /supplierB/hotels?city=delhi`

Returns raw inventory feeds directly from mock partners.

---

## 🧪 Automated Test Suite

The test suite covers unit, domain, repository, integration, and contract tests:

```bash
# Run all 71 automated test cases
npm test

# Run tests with live log output
TEST_LOGS=true npm test
```

### Test Coverage Highlights:
- **`deduplication.test.ts` (13 tests)**: Verifies lowest price selection, tie-breaking on identical rates, whitespace trimming, zero promotional pricing, 2000-hotel stress benchmarking, and corrupt data filtering.
- **`temporal-activities.test.ts` (10 tests)**: Verifies resilient HTTP execution, URL normalization with trailing slash removal, special character URL encoding, timeout recovery (`ECONNABORTED`), and graceful degradation under single-supplier outages.
- **`redis.test.ts` (14 tests)**: Validates sorted-set score indexing, hash serialization, exact boundary matches (`minPrice == maxPrice`), case-insensitive key normalization, and graceful recovery from corrupt JSON hash records.
- **`api-integration.test.ts` (20 tests)**: Tests Express routes, negative prices, string non-numbers, length limit guards (>100 chars), range inversions (`min > max`), cold cache-miss workflow triggering, Temporal 500 error boundaries, CORS preflight, and `/health`.
- **`suppliers.test.ts` (11 tests)**: Tests mock inventory filtering, case insensitivity, city fallback, and overlapping feed detection.
- **`postman.test.ts` (3 tests)**: Validates Postman collection JSON structure and test coverage assertions.

---

## 📮 Postman Collection

A complete, production-ready Postman collection is included in the repository:
📁 **[`postman/Hotel_Offer_Orchestrator.postman_collection.json`](postman/Hotel_Offer_Orchestrator.postman_collection.json)**

### How to Import:
1. Open Postman.
2. Click **Import** (top left).
3. Drag & drop the JSON file.
4. Run the collection to verify all 6 test scenarios:
   - Valid search (`city=delhi`)
   - Price range search (`city=delhi&minPrice=5000&maxPrice=8000`)
   - Unknown city (`city=atlantis`)
   - Missing parameter validation error (`400 Bad Request`)
   - Health check probe (`/health`)
   - Direct supplier inspections

---

## 🔧 Troubleshooting & FAQ

### 1. Port Collision on Host (`EADDRINUSE: 3000`)
If port 3000 or 6379 is in use by another application:
```bash
# On Windows PowerShell:
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force

# On Linux/macOS:
lsof -i :3000 | awk 'NR>1 {print $2}' | xargs kill -9
```

### 2. Checking Container Logs
To inspect live application logs with file-name scoping:
```bash
docker compose logs -f api
docker compose logs -f worker
```

### 3. Restarting or Resetting the Environment
```bash
docker compose down -v
docker compose up -d --build
```

---

## 📄 Submission Info

- **Repository**: [https://github.com/sachinjat2802/hotel-offer-orchestrator](https://github.com/sachinjat2802/hotel-offer-orchestrator)
- **Commit History**: Clean single-commit squash (`git log --oneline`).
- **Assignment**: Hotel Offer Orchestrator (Tripare.ai Evaluation).
- **Candidate Email**: `sachinjat2802@gmail.com`
