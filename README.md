# Priceverse

Real-time cryptocurrency price aggregation service built on the Titan framework. Collects trade data from 6 major exchanges via WebSocket, calculates VWAP (Volume Weighted Average Price), and provides unified pricing through RPC services.

## Features

- **Multi-Exchange Data Collection** — WebSocket connections to Binance, Kraken, Coinbase, OKX, Bybit, KuCoin
- **Real-Time VWAP Aggregation** — Volume-weighted price calculation every 10 seconds
- **OHLCV Candle Generation** — 5-minute, 1-hour, and daily candles
- **RUB Conversion** — Automatic conversion via Central Bank of Russia rates
- **Process Isolation** — Worker thread-based collectors with automatic restart
- **Health Monitoring** — Real-time health checks for all components
- **CLI Client** — Interactive dashboard, price queries, and health checks

## Supported Trading Pairs

| USD Pairs | RUB Pairs |
|-----------|-----------|
| BTC/USD   | BTC/RUB   |
| ETH/USD   | ETH/RUB   |
| XMR/USD   | XMR/RUB   |

## Quick Start

### Prerequisites

- Node.js >= 22.0.0
- pnpm
- Docker & Docker Compose

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd priceverse

# Install dependencies
pnpm install

# Start infrastructure (PostgreSQL + Redis)
docker-compose up -d

# Run database migrations
pnpm migrate

# Start development server
pnpm dev
```

### Verify Installation

```bash
# Check server health
pnpm client --health

# View current prices
pnpm client
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Priceverse                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   PM Processes (Workers)                  │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│  │  │ Binance │ │ Kraken  │ │Coinbase │ │   OKX   │ ...    │   │
│  │  │Collector│ │Collector│ │Collector│ │Collector│        │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │   │
│  │       │           │           │           │              │   │
│  │       └───────────┴─────┬─────┴───────────┘              │   │
│  │                         ▼                                │   │
│  │              ┌──────────────────┐                        │   │
│  │              │  Redis Streams   │                        │   │
│  │              │ stream:trades:*  │                        │   │
│  │              └────────┬─────────┘                        │   │
│  │                       ▼                                  │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │              Stream Aggregator                      │ │   │
│  │  │  • Consumes trades from Redis Streams              │ │   │
│  │  │  • Calculates VWAP every 10 seconds                │ │   │
│  │  │  • Stores in price_history table                   │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    RPC Services (Netron)                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │   │
│  │  │   Prices    │  │   Charts    │  │   Health    │       │   │
│  │  │  Service    │  │  Service    │  │  Service    │       │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Data Layer                           │   │
│  │  ┌─────────────┐              ┌─────────────┐            │   │
│  │  │ PostgreSQL  │              │    Redis    │            │   │
│  │  │ • prices    │              │ • cache     │            │   │
│  │  │ • OHLCV     │              │ • pub/sub   │            │   │
│  │  └─────────────┘              └─────────────┘            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
priceverse/
├── src/
│   ├── main.ts                    # Application entry point
│   ├── app.module.ts              # Root module with DI configuration
│   ├── client.ts                  # CLI client
│   │
│   ├── processes/                 # PM worker processes
│   │   ├── collectors/            # Exchange WebSocket collectors
│   │   │   ├── base-collector.process.ts
│   │   │   ├── binance.process.ts
│   │   │   ├── kraken.process.ts
│   │   │   ├── coinbase.process.ts
│   │   │   ├── okx.process.ts
│   │   │   ├── bybit.process.ts
│   │   │   └── kucoin.process.ts
│   │   └── aggregators/           # Data aggregation processes
│   │       ├── stream-aggregator.process.ts   # Real-time VWAP
│   │       └── ohlcv-aggregator.process.ts    # Candle generation
│   │
│   ├── modules/                   # Business modules
│   │   ├── prices/                # Price RPC service
│   │   ├── charts/                # Charts/OHLCV RPC service
│   │   ├── health/                # Health monitoring
│   │   ├── collector/             # CBR rate service
│   │   ├── aggregator/            # OHLCV scheduler
│   │   ├── pm/                    # Process manager configuration
│   │   ├── metrics/               # Metrics collection
│   │   ├── retention/             # Data cleanup
│   │   ├── alerts/                # Alert notifications
│   │   └── ratelimit/             # API rate limiting
│   │
│   ├── database/                  # Data access layer
│   │   ├── schema.ts              # Kysely table types
│   │   ├── repositories/          # Data repositories
│   │   └── migrations/            # Database migrations
│   │
│   ├── contracts/                 # Data contracts
│   │   ├── errors.ts              # Error codes and classes
│   │   ├── schemas.ts             # Zod validation schemas
│   │   └── services.ts            # RPC service interfaces
│   │
│   ├── shared/                    # Shared utilities
│   │   ├── types.ts               # Type definitions
│   │   └── tokens.ts              # DI tokens
│   │
│   └── config/                    # Configuration
│       └── config.schema.ts       # Zod config schema
│
├── config/
│   └── default.json               # Default configuration
│
├── test/                          # Tests
│   ├── unit/                      # Unit tests
│   ├── integration/               # Integration tests
│   └── e2e/                       # End-to-end tests
│
├── docker-compose.yml             # Infrastructure services
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## CLI Client

```bash
# Show all prices
pnpm client

# Show specific pairs
pnpm client btc-usd eth-usd

# Interactive mode
pnpm client --interactive
pnpm client -i

# Live dashboard (auto-refresh every 5 seconds)
pnpm client --dashboard
pnpm client -d

# Health check
pnpm client --health

# OHLCV history
pnpm client --history btc-usd --interval 1hour --limit 24

# Connect to custom server
pnpm client --url http://priceverse.example.com:3000
```

### Example Output

```
╭──────────────┬────────────────────┬──────────────┬────────────────────╮
│ Pair         │              Price │   24h Change │      Updated       │
├──────────────┼────────────────────┼──────────────┼────────────────────┤
│ BTC/USD      │         $89,347.50 │       +2.34% │  16.12, 15:34:55   │
│ ETH/USD      │          $3,091.07 │       -0.87% │  16.12, 15:34:45   │
│ XMR/USD      │            $409.22 │       +1.12% │  16.12, 15:33:25   │
│ BTC/RUB      │      ₽7,123,640.44 │       +2.34% │  16.12, 15:34:55   │
│ ETH/RUB      │        ₽246,450.07 │       -0.87% │  16.12, 15:34:45   │
│ XMR/RUB      │         ₽32,626.95 │       +1.12% │  16.12, 15:33:25   │
╰──────────────┴────────────────────┴──────────────┴────────────────────╯
```

## API Reference

Priceverse exposes RPC services via Netron HTTP transport at `http://localhost:3000`.

### Prices Service

#### Get Single Price

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "PricesService@2.0.0",
    "method": "getPrice",
    "args": [{ "pair": "btc-usd" }]
  }'
```

Response:
```json
{
  "pair": "btc-usd",
  "price": "89347.50",
  "timestamp": "2025-12-16T12:34:55.000Z",
  "sources": ["binance", "kraken", "coinbase", "okx", "bybit", "kucoin"],
  "method": "vwap"
}
```

#### Get Multiple Prices

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "PricesService@2.0.0",
    "method": "getMultiplePrices",
    "args": [{ "pairs": ["btc-usd", "eth-usd", "xmr-usd"] }]
  }'
```

#### Get Price Change

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "PricesService@2.0.0",
    "method": "getPriceChange",
    "args": [{ "pair": "btc-usd", "period": "24hours" }]
  }'
```

### Charts Service

#### Get OHLCV Candles

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "ChartsService@2.0.0",
    "method": "getOHLCV",
    "args": [{
      "pair": "btc-usd",
      "interval": "1hour",
      "limit": 24
    }]
  }'
```

Response:
```json
{
  "pair": "btc-usd",
  "interval": "1hour",
  "candles": [
    {
      "timestamp": "2025-12-16T11:00:00.000Z",
      "open": "89100.00",
      "high": "89500.00",
      "low": "89050.00",
      "close": "89347.50",
      "volume": "1234.56",
      "vwap": "89275.30"
    }
  ],
  "total": 24
}
```

#### Get Chart Data

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "ChartsService@2.0.0",
    "method": "getChartData",
    "args": [{
      "pair": "btc-usd",
      "period": "7days",
      "interval": "1hour"
    }]
  }'
```

### Health Service

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "service": "HealthService@1.0.0",
    "method": "check",
    "args": []
  }'
```

Response:
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "uptime": 3600,
  "timestamp": "2025-12-16T12:34:55.000Z",
  "checks": {
    "database": { "status": "up", "latency": 2 },
    "redis": { "status": "up", "latency": 1 },
    "exchanges": { "status": "up", "message": "6/6 exchanges connected" }
  }
}
```

## Configuration

### Environment Variables

Configuration can be set via environment variables with `PRICEVERSE_` prefix and `__` separator for nested values:

```bash
# Application
PRICEVERSE_APP__PORT=3000
PRICEVERSE_APP__HOST=0.0.0.0

# Database
PRICEVERSE_DATABASE__HOST=localhost
PRICEVERSE_DATABASE__PORT=5432
PRICEVERSE_DATABASE__DATABASE=priceverse
PRICEVERSE_DATABASE__USER=postgres
PRICEVERSE_DATABASE__PASSWORD=postgres

# Redis
PRICEVERSE_REDIS__HOST=localhost
PRICEVERSE_REDIS__PORT=6379

# Exchanges
PRICEVERSE_EXCHANGES__ENABLED=binance,kraken,coinbase,okx,bybit,kucoin

# Aggregation
PRICEVERSE_AGGREGATION__INTERVAL=10000
PRICEVERSE_AGGREGATION__WINDOW_SIZE=30000
PRICEVERSE_AGGREGATION__PAIRS=btc-usd,xmr-usd,eth-usd
```

### Configuration File

See `config/default.json` for all available options:

```json
{
  "app": {
    "name": "priceverse",
    "version": "2.0.0",
    "port": 3000,
    "host": "0.0.0.0"
  },
  "database": {
    "dialect": "postgres",
    "host": "localhost",
    "port": 5432,
    "database": "priceverse",
    "user": "postgres",
    "password": "postgres",
    "pool": { "min": 2, "max": 20 }
  },
  "redis": {
    "host": "localhost",
    "port": 6379,
    "db": 0
  },
  "aggregation": {
    "interval": 10000,
    "windowSize": 30000,
    "pairs": ["btc-usd", "xmr-usd", "eth-usd"]
  },
  "retention": {
    "enabled": true,
    "priceHistoryDays": 7,
    "candles5minDays": 30,
    "candles1hourDays": 365,
    "cleanupSchedule": "0 3 * * *"
  }
}
```

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `price_history` | Aggregated VWAP prices (raw) |
| `price_history_5min` | 5-minute OHLCV candles |
| `price_history_1hour` | 1-hour OHLCV candles |
| `price_history_1day` | Daily OHLCV candles |

### Migrations

```bash
# Run migrations
pnpm migrate

# Rollback migrations
pnpm migrate:down
```

## Development

### Scripts

```bash
# Development with hot reload
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start:prod

# Type checking
pnpm typecheck

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:cov

# Run specific test suites
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

### Testing

The project uses Vitest for testing with the following structure:

- **Unit Tests** (`test/unit/`) — Isolated component tests with mocks
- **Integration Tests** (`test/integration/`) — Tests with real database/Redis
- **E2E Tests** (`test/e2e/`) — Full API tests

Coverage targets: 80% lines, 75% branches, 80% functions.

## Deployment

### Docker Compose (Development)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Deployment

1. Build the application:
   ```bash
   pnpm build
   ```

2. Set environment variables (see Configuration section)

3. Run database migrations:
   ```bash
   pnpm migrate
   ```

4. Start the server:
   ```bash
   pnpm start:prod
   ```

## Monitoring

### Health Checks

The `/health` endpoint provides real-time system status:

- **Database** — Connection pool status, query latency
- **Redis** — Connection status, ping latency
- **Exchanges** — WebSocket connection status per exchange
- **Aggregators** — Processing status and error rates

### Metrics

The Metrics service collects:

- Cache hit/miss ratios
- Database query times
- Redis operation counts
- Exchange collector statistics
- System resource usage (memory, CPU)

### Alerts

When enabled (`alerts.enabled: true`), the system can send notifications for:

- Exchange disconnections lasting > 5 minutes
- Consecutive aggregation failures
- Stale CBR exchange rates

## Error Codes

| Code Range | Category | Examples |
|------------|----------|----------|
| 1xxx | Price | `PAIR_NOT_FOUND`, `PRICE_UNAVAILABLE`, `PRICE_STALE` |
| 2xxx | Chart | `CHART_DATA_NOT_FOUND`, `INVALID_INTERVAL` |
| 3xxx | Exchange | `EXCHANGE_DISCONNECTED`, `EXCHANGE_RATE_LIMITED` |
| 4xxx | Validation | `INVALID_PAIR`, `INVALID_PARAMS` |
| 5xxx | System | `DATABASE_ERROR`, `REDIS_ERROR` |
| 6xxx | Stream | `STREAM_ABORTED`, `STREAM_TIMEOUT` |

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.9
- **Framework**: Titan (Process Manager, Netron RPC, Scheduler)
- **Database**: PostgreSQL (primary), MySQL/SQLite (supported)
- **Cache**: Redis 7
- **Query Builder**: Kysely
- **Validation**: Zod
- **Testing**: Vitest
- **Package Manager**: pnpm

## License

MIT
