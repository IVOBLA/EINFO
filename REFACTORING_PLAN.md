# Chatbot Refactoring-Plan

## Zielsetzung
Den Chatbot robuster, wartbarer und testbarer machen, ohne die Funktionalität zu beeinträchtigen.

---

## Phase 1: Fundamentale Verbesserungen (Priorität: Hoch)

### 1.1 Konfigurationsmanagement zentralisieren

**Problem:** Magic Numbers und hardcodierte Werte überall verstreut

**Vorher:**
```javascript
// In verschiedenen Dateien:
const WORKER_INTERVAL_MS = 30000;
const heartbeat = setInterval(() => { ... }, 30000);
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 5000;
```

**Nachher:**
```javascript
// config/constants.js
export const TIMEOUTS = {
  WORKER_INTERVAL_MS: 30000,
  SSE_HEARTBEAT_MS: 30000,
  RETRY_DELAY_MS: 5000,
  LLM_TIMEOUT_MS: 60000,
  FETCH_TIMEOUT_MS: 10000
};

export const LIMITS = {
  MAX_RETRIES: 10,
  MAX_BOARD_ITEMS: 25,
  MAX_AUFGABEN_ITEMS: 50,
  MAX_PROTOKOLL_ITEMS: 30,
  MAX_ACTION_HISTORY: 500
};

export const PATHS = {
  DATA_DIR: path.join(process.cwd(), 'data'),
  LOG_DIR: path.join(process.cwd(), 'logs'),
  KNOWLEDGE_DIR: path.join(__dirname, '..', 'knowledge')
};
```

**Aufwand:** 4-6 Stunden
**Impact:** Hoch - Wartbarkeit ↑, Testing ↑

---

### 1.2 Error Handling vereinheitlichen

**Problem:** Inkonsistente Fehlerbehandlung (manchmal throw, manchmal log, manchmal return null)

**Vorher:**
```javascript
// Verschiedene Patterns:
try {
  const data = await loadData();
  return data;
} catch (err) {
  console.error(err);
  return null;
}

// Oder:
try {
  await doSomething();
} catch (err) {
  logError("Fehler", { error: String(err) });
  // Fehler wird geschluckt
}
```

**Nachher:**
```javascript
// utils/error-handler.js
export class ChatbotError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ChatbotError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export const ErrorCodes = {
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  DATA_READ_FAILED: 'DATA_READ_FAILED',
  SIMULATION_ERROR: 'SIMULATION_ERROR',
  SSE_ERROR: 'SSE_ERROR'
};

// Verwendung:
export async function safeReadJson(filePath, defaultValue) {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      logDebug('File not found, using default', { filePath });
      return defaultValue;
    }
    throw new ChatbotError(
      `Failed to read JSON file: ${filePath}`,
      ErrorCodes.DATA_READ_FAILED,
      { originalError: err.message, filePath }
    );
  }
}
```

**Aufwand:** 6-8 Stunden
**Impact:** Hoch - Debugging ↑, Robustheit ↑

---

### 1.3 Dependency Injection für Testbarkeit

**Problem:** Direkter Import von Modulen macht Unit-Tests schwierig

**Vorher:**
```javascript
// chatbot_worker.js
import { readAufgBoardFile } from "../chatbot/server/aufgaben_board_io.js";

async function runOnce() {
  const boards = await loadAufgabenBoardsForRoles(roleIds);
  // ...
}
```

**Nachher:**
```javascript
// worker/worker-service.js
export class WorkerService {
  constructor(dependencies = {}) {
    this.boardIO = dependencies.boardIO || defaultBoardIO;
    this.llmClient = dependencies.llmClient || defaultLLMClient;
    this.logger = dependencies.logger || defaultLogger;
  }

  async runOnce() {
    const boards = await this.boardIO.loadAufgabenBoardsForRoles(roleIds);
    // ...
  }
}

// Verwendung in Production:
const worker = new WorkerService();

// Verwendung in Tests:
const mockBoardIO = { loadAufgabenBoardsForRoles: jest.fn() };
const worker = new WorkerService({ boardIO: mockBoardIO });
```

**Aufwand:** 10-12 Stunden
**Impact:** Sehr hoch - Testbarkeit ↑↑, Wartbarkeit ↑

---

## Phase 2: Code-Struktur & Organisation (Priorität: Mittel)

### 2.1 Modulare Architektur mit klaren Grenzen

**Aktuell:** Monolithische Dateien mit vielen Verantwortlichkeiten

**Ziel-Struktur:**
```
chatbot/
├── server/
│   ├── api/                    # API Routes
│   │   ├── simulation.routes.js
│   │   ├── chat.routes.js
│   │   ├── audit.routes.js
│   │   └── llm.routes.js
│   ├── services/               # Business Logic
│   │   ├── simulation-service.js
│   │   ├── llm-service.js
│   │   ├── sse-service.js
│   │   └── disaster-service.js
│   ├── repositories/           # Data Access Layer
│   │   ├── board-repository.js
│   │   ├── protocol-repository.js
│   │   └── task-repository.js
│   ├── utils/                  # Utilities
│   │   ├── error-handler.js
│   │   ├── validation.js
│   │   └── retry.js
│   ├── middleware/
│   │   ├── rate-limit.js
│   │   ├── auth.js
│   │   └── error-handler.js
│   ├── config/
│   │   ├── constants.js
│   │   ├── environment.js
│   │   └── models.js
│   └── types/                  # JSDoc Types oder TypeScript
│       └── index.js
```

**Beispiel - Simulation Service extrahieren:**

```javascript
// services/simulation-service.js
export class SimulationService {
  constructor({ llmService, boardRepo, protocolRepo, taskRepo, logger }) {
    this.llm = llmService;
    this.boardRepo = boardRepo;
    this.protocolRepo = protocolRepo;
    this.taskRepo = taskRepo;
    this.logger = logger;
    this.state = {
      running: false,
      stepInProgress: false,
      activeScenario: null
    };
  }

  async start(scenario = null) {
    if (this.state.running) {
      throw new ChatbotError('Simulation bereits gestartet', ErrorCodes.INVALID_STATE);
    }

    this.state.running = true;
    this.state.activeScenario = scenario;

    this.logger.info('Simulation gestartet', { scenarioId: scenario?.id });
  }

  async step(options = {}) {
    if (!this.state.running) {
      return { ok: false, reason: 'not_running' };
    }

    if (this.state.stepInProgress && !options.forceConcurrent) {
      return { ok: false, reason: 'step_in_progress' };
    }

    this.state.stepInProgress = true;

    try {
      return await this._executeStep(options);
    } finally {
      this.state.stepInProgress = false;
    }
  }

  async _executeStep(options) {
    // Eigentliche Logik hier
  }

  pause() {
    this.state.running = false;
    this.logger.info('Simulation pausiert');
  }

  getStatus() {
    return { ...this.state };
  }
}
```

**Aufwand:** 16-20 Stunden
**Impact:** Sehr hoch - Wartbarkeit ↑↑, Testbarkeit ↑↑, Übersichtlichkeit ↑↑

---

### 2.2 Repository Pattern für Datenzugriff

**Problem:** Datenzugriff ist über den Code verstreut

**Vorher:**
```javascript
// Überall im Code:
const boardPath = path.join(dataDir, FILES.board);
let boardRaw = await safeReadJson(boardPath, { columns: {} });
boardRaw = ensureBoardStructure(boardRaw);
// ... Modifikationen ...
await safeWriteJson(boardPath, boardRaw);
```

**Nachher:**
```javascript
// repositories/board-repository.js
export class BoardRepository {
  constructor({ dataDir, logger }) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.boardPath = path.join(dataDir, 'board.json');
  }

  async load() {
    try {
      const raw = await safeReadJson(this.boardPath, { columns: {} });
      return this._ensureStructure(raw);
    } catch (err) {
      this.logger.error('Failed to load board', { error: err.message });
      throw new ChatbotError('Board laden fehlgeschlagen', ErrorCodes.DATA_READ_FAILED);
    }
  }

  async save(board) {
    const validated = this._validate(board);
    await safeWriteJson(this.boardPath, validated);
    this.logger.debug('Board gespeichert', { itemCount: this._countItems(validated) });
  }

  async getItems(filters = {}) {
    const board = await this.load();
    let items = this._flatten(board);

    if (filters.status) {
      items = items.filter(i => i.status === filters.status);
    }

    if (filters.limit) {
      items = items.slice(0, filters.limit);
    }

    return items;
  }

  async addItem(item) {
    const board = await this.load();
    const validated = this._validateItem(item);

    board.columns['neu'].items.push({
      ...validated,
      id: this._generateId(),
      createdAt: new Date().toISOString()
    });

    await this.save(board);
  }

  _ensureStructure(board) { /* ... */ }
  _validate(board) { /* ... */ }
  _flatten(board) { /* ... */ }
  _countItems(board) { /* ... */ }
  _generateId() { return `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
}

// Verwendung:
const boardRepo = new BoardRepository({ dataDir, logger });
const items = await boardRepo.getItems({ status: 'neu', limit: 10 });
await boardRepo.addItem({ content: 'Neue Einsatzstelle', ort: 'Feldkirchen' });
```

**Aufwand:** 12-16 Stunden
**Impact:** Hoch - Wartbarkeit ↑, Testbarkeit ↑, Code-Duplikation ↓

---

### 2.3 SSE-Service extrahieren

**Problem:** SSE-Logik ist im Hauptserver-File

**Nachher:**
```javascript
// services/sse-service.js
export class SSEService {
  constructor({ logger }) {
    this.logger = logger;
    this.clients = new Set();
    this.heartbeats = new Map();
    this.heartbeatInterval = 30000;
  }

  addClient(res) {
    this.clients.add(res);
    this.logger.info('SSE-Client verbunden', { count: this.clients.size });

    this._sendInitialStatus(res);
    this._startHeartbeat(res);
    this._setupCleanup(res);

    return () => this.removeClient(res);
  }

  removeClient(res) {
    const heartbeat = this.heartbeats.get(res);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(res);
    }
    this.clients.delete(res);
    this.logger.info('SSE-Client getrennt', { count: this.clients.size });
  }

  broadcast(eventType, data) {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    const deadClients = [];

    for (const client of this.clients) {
      if (!this._isClientAlive(client)) {
        deadClients.push(client);
        continue;
      }

      try {
        client.write(message);
      } catch (err) {
        this.logger.debug('Failed to write to client', { error: err.message });
        deadClients.push(client);
      }
    }

    deadClients.forEach(client => this.removeClient(client));
  }

  cleanup() {
    this.logger.info('Cleanup: Schließe alle SSE-Clients', { count: this.clients.size });

    for (const client of this.clients) {
      try {
        this.removeClient(client);
        if (client.writable) client.end();
      } catch {
        // Ignore
      }
    }
  }

  _isClientAlive(client) {
    return !client.destroyed && client.writable;
  }

  _startHeartbeat(res) {
    const heartbeat = setInterval(() => {
      if (!this._isClientAlive(res)) {
        this.removeClient(res);
        return;
      }

      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        this.removeClient(res);
      }
    }, this.heartbeatInterval);

    this.heartbeats.set(res, heartbeat);
  }

  _sendInitialStatus(res) {
    // Status senden
  }

  _setupCleanup(res) {
    res.req.on('close', () => this.removeClient(res));
  }
}

// In index.js:
const sseService = new SSEService({ logger });

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseService.addClient(res);
});

// Cleanup bei Shutdown
process.on("SIGINT", () => {
  sseService.cleanup();
  process.exit(0);
});
```

**Aufwand:** 4-6 Stunden
**Impact:** Mittel - Wartbarkeit ↑, Testbarkeit ↑

---

## Phase 3: Type Safety & Validation (Priorität: Mittel)

### 3.1 JSDoc Types oder TypeScript

**Option A: JSDoc (ohne Build-Step):**

```javascript
// types/index.js

/**
 * @typedef {Object} BoardItem
 * @property {string} id
 * @property {string} content
 * @property {'neu'|'in-bearbeitung'|'erledigt'} status
 * @property {string} ort
 * @property {string} typ
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {'Neu'|'In Bearbeitung'|'Erledigt'|'Storniert'} status
 * @property {string} responsible
 * @property {string} desc
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ProtocolEntry
 * @property {string} id
 * @property {number} nr
 * @property {string} datum
 * @property {string} zeit
 * @property {string} infoTyp
 * @property {string} anvon
 * @property {string} information
 * @property {string[]} ergehtAn
 */

// Verwendung:
/**
 * Lädt Board-Items
 * @returns {Promise<BoardItem[]>}
 */
export async function loadBoard() {
  // ...
}

/**
 * Erstellt neue Aufgabe
 * @param {Partial<Task>} taskData
 * @returns {Promise<Task>}
 */
export async function createTask(taskData) {
  // ...
}
```

**Option B: TypeScript (mit Build-Step):**

```typescript
// types/index.ts
export type BoardStatus = 'neu' | 'in-bearbeitung' | 'erledigt';

export interface BoardItem {
  id: string;
  content: string;
  status: BoardStatus;
  ort: string;
  typ: string;
  createdAt: string;
  updatedAt: string;
  assignedVehicles?: string[];
}

export interface Task {
  id: string;
  title: string;
  status: 'Neu' | 'In Bearbeitung' | 'Erledigt' | 'Storniert';
  responsible: string;
  desc: string;
  createdAt: number;
  updatedAt: number;
  relatedIncidentId?: string;
}

// Verwendung:
export async function loadBoard(): Promise<BoardItem[]> {
  // TypeScript prüft zur Compile-Zeit
}

export async function createTask(taskData: Partial<Task>): Promise<Task> {
  // Auto-completion und Type-Checking
}
```

**Empfehlung:** JSDoc für schnellen Start, später Migration zu TypeScript

**Aufwand:**
- JSDoc: 6-8 Stunden
- TypeScript: 20-30 Stunden (inkl. Setup und Migration)

**Impact:** Hoch - Fehler ↓, Developer Experience ↑

---

### 3.2 Input Validation mit Schema

**Vorher:**
```javascript
app.post("/api/feedback", async (req, res) => {
  const { rating, question } = req.body || {};

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: "Ungültiges Rating" });
  }

  // Was ist mit den anderen Feldern?
});
```

**Nachher (mit Zod):**

```javascript
// validation/schemas.js
import { z } from 'zod';

export const FeedbackSchema = z.object({
  disasterId: z.string().optional(),
  disasterType: z.string().optional(),
  disasterPhase: z.enum(['vorbereitung', 'einsatz', 'nachbereitung']).optional(),
  interactionType: z.enum(['chat', 'simulation', 'suggestion']),
  question: z.string().min(1).max(5000),
  llmResponse: z.string().min(1),
  llmModel: z.string(),
  rating: z.number().int().min(1).max(5),
  helpful: z.boolean().optional(),
  accurate: z.boolean().optional(),
  actionable: z.boolean().optional(),
  userId: z.string().optional(),
  userRole: z.string().optional(),
  comment: z.string().max(2000).optional(),
  implemented: z.boolean().optional(),
  outcome: z.string().max(2000).optional()
});

export const SimulationStepSchema = z.object({
  source: z.enum(['worker', 'manual', 'api']).default('manual'),
  memorySnippets: z.array(z.string()).optional(),
  forceConcurrent: z.boolean().optional()
});

// middleware/validate.js
export function validate(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          ok: false,
          error: 'Validation failed',
          details: err.errors
        });
      }
      next(err);
    }
  };
}

// Verwendung:
app.post("/api/feedback", validate(FeedbackSchema), async (req, res) => {
  const feedback = req.validated; // Typsicher und validiert!
  await saveFeedback(feedback);
  res.json({ ok: true });
});
```

**Aufwand:** 8-10 Stunden
**Impact:** Hoch - Robustheit ↑, Security ↑

---

## Phase 4: Testing (Priorität: Mittel-Hoch)

### 4.1 Unit Tests einführen

```javascript
// tests/unit/services/simulation-service.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimulationService } from '../../../server/services/simulation-service.js';

describe('SimulationService', () => {
  let service;
  let mockLLM;
  let mockBoardRepo;
  let mockLogger;

  beforeEach(() => {
    mockLLM = {
      callForOps: vi.fn()
    };
    mockBoardRepo = {
      load: vi.fn(),
      save: vi.fn()
    };
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    service = new SimulationService({
      llmService: mockLLM,
      boardRepo: mockBoardRepo,
      logger: mockLogger
    });
  });

  describe('start', () => {
    it('should start simulation successfully', async () => {
      await service.start({ id: 'test-scenario' });

      expect(service.getStatus().running).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Simulation gestartet',
        expect.objectContaining({ scenarioId: 'test-scenario' })
      );
    });

    it('should throw error if already running', async () => {
      await service.start();

      await expect(service.start()).rejects.toThrow('Simulation bereits gestartet');
    });
  });

  describe('step', () => {
    it('should not execute if not running', async () => {
      const result = await service.step();

      expect(result).toEqual({ ok: false, reason: 'not_running' });
    });

    it('should execute step successfully', async () => {
      mockBoardRepo.load.mockResolvedValue({ columns: {} });
      mockLLM.callForOps.mockResolvedValue({
        parsed: { operations: {}, analysis: 'Test' }
      });

      await service.start();
      const result = await service.step();

      expect(result.ok).toBe(true);
      expect(mockLLM.callForOps).toHaveBeenCalled();
    });

    it('should prevent concurrent steps by default', async () => {
      await service.start();

      // Erster Step startet
      const promise1 = service.step();

      // Zweiter Step wird blockiert
      const result2 = await service.step();
      expect(result2).toEqual({ ok: false, reason: 'step_in_progress' });

      await promise1;
    });
  });
});
```

**Test-Struktur:**
```
tests/
├── unit/
│   ├── services/
│   │   ├── simulation-service.test.js
│   │   ├── llm-service.test.js
│   │   └── sse-service.test.js
│   ├── repositories/
│   │   ├── board-repository.test.js
│   │   └── protocol-repository.test.js
│   └── utils/
│       ├── error-handler.test.js
│       └── validation.test.js
├── integration/
│   ├── api/
│   │   ├── simulation.test.js
│   │   └── chat.test.js
│   └── worker/
│       └── worker-service.test.js
└── e2e/
    ├── simulation-flow.test.js
    └── chat-flow.test.js
```

**Aufwand:** 30-40 Stunden (initiale Suite)
**Impact:** Sehr hoch - Robustheit ↑↑, Regression-Schutz ↑↑

---

### 4.2 Integration Tests

```javascript
// tests/integration/api/simulation.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../helpers/test-app.js';
import { setupTestDatabase } from '../../helpers/test-db.js';

describe('Simulation API', () => {
  let app;
  let cleanup;

  beforeAll(async () => {
    const testDb = await setupTestDatabase();
    app = await createTestApp({ dataDir: testDb.path });
    cleanup = testDb.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('POST /api/sim/start', () => {
    it('should start simulation without scenario', async () => {
      const response = await request(app)
        .post('/api/sim/start')
        .send({})
        .expect(200);

      expect(response.body).toMatchObject({
        ok: true,
        scenario: null
      });
    });

    it('should start simulation with valid scenario', async () => {
      const response = await request(app)
        .post('/api/sim/start')
        .send({ scenarioId: 'hochwasser_1' })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.scenario).toMatchObject({
        id: 'hochwasser_1'
      });
    });

    it('should return 404 for invalid scenario', async () => {
      const response = await request(app)
        .post('/api/sim/start')
        .send({ scenarioId: 'invalid' })
        .expect(404);

      expect(response.body.ok).toBe(false);
    });
  });
});
```

**Aufwand:** 20-30 Stunden
**Impact:** Hoch - Integration-Sicherheit ↑

---

## Phase 5: Performance & Monitoring (Priorität: Niedrig-Mittel)

### 5.1 Performance Monitoring hinzufügen

```javascript
// middleware/performance.js
export function performanceMonitoring() {
  return (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;

      if (duration > 1000) {
        logger.warn('Slow request detected', {
          method: req.method,
          path: req.path,
          duration,
          status: res.statusCode
        });
      }

      // Metriken sammeln
      metrics.recordHttpRequest({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration
      });
    });

    next();
  };
}

// services/metrics-service.js
export class MetricsService {
  constructor() {
    this.httpRequests = new Map();
    this.llmCalls = [];
    this.simulationSteps = [];
  }

  recordHttpRequest({ method, path, status, duration }) {
    const key = `${method} ${path}`;
    const existing = this.httpRequests.get(key) || {
      count: 0,
      totalDuration: 0,
      maxDuration: 0,
      minDuration: Infinity,
      statusCodes: {}
    };

    existing.count++;
    existing.totalDuration += duration;
    existing.maxDuration = Math.max(existing.maxDuration, duration);
    existing.minDuration = Math.min(existing.minDuration, duration);
    existing.statusCodes[status] = (existing.statusCodes[status] || 0) + 1;

    this.httpRequests.set(key, existing);
  }

  getStats() {
    const httpStats = {};
    for (const [key, value] of this.httpRequests) {
      httpStats[key] = {
        ...value,
        avgDuration: value.totalDuration / value.count
      };
    }

    return {
      http: httpStats,
      llm: this._aggregateLLMStats(),
      simulation: this._aggregateSimulationStats()
    };
  }
}
```

**Aufwand:** 6-8 Stunden
**Impact:** Mittel - Monitoring ↑, Performance-Insights ↑

---

### 5.2 Caching-Layer

```javascript
// services/cache-service.js
export class CacheService {
  constructor({ ttlMs = 60000 }) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Auto-cleanup alter Einträge
  startCleanup(intervalMs = 60000) {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }, intervalMs);
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Verwendung in BoardRepository:
export class BoardRepository {
  constructor({ dataDir, logger, cache }) {
    this.cache = cache;
    // ...
  }

  async load() {
    const cacheKey = 'board:latest';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const board = await this._loadFromDisk();
    this.cache.set(cacheKey, board, 5000); // 5s TTL
    return board;
  }

  async save(board) {
    await this._saveToDisk(board);
    this.cache.delete('board:latest'); // Invalidate cache
  }
}
```

**Aufwand:** 4-6 Stunden
**Impact:** Mittel - Performance ↑ (für häufige Reads)

---

## Phase 6: Dokumentation (Priorität: Mittel)

### 6.1 API-Dokumentation mit OpenAPI

```yaml
# docs/openapi.yaml
openapi: 3.0.0
info:
  title: EINFO Chatbot API
  version: 1.0.0
  description: API für Katastrophenmanagement Chatbot und Simulation

servers:
  - url: http://localhost:3100
    description: Lokale Entwicklung

paths:
  /api/sim/start:
    post:
      summary: Startet die Simulation
      tags:
        - Simulation
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                scenarioId:
                  type: string
                  description: ID des zu ladenden Szenarios
                  example: hochwasser_1
      responses:
        '200':
          description: Simulation erfolgreich gestartet
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
                  scenario:
                    $ref: '#/components/schemas/Scenario'

components:
  schemas:
    Scenario:
      type: object
      properties:
        id:
          type: string
        title:
          type: string
        description:
          type: string
```

**Aufwand:** 8-10 Stunden
**Impact:** Mittel - Developer Experience ↑, API-Verständnis ↑

---

### 6.2 Architektur-Dokumentation

```markdown
# docs/ARCHITECTURE.md

## System-Architektur

### Übersicht
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│ Express API  │────▶│  Services   │
│   (GUI)     │     │  (index.js)  │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
                            │                     │
                            │                     ▼
                            │             ┌─────────────┐
                            │             │Repositories │
                            │             │             │
                            │             └─────────────┘
                            │                     │
                            ▼                     ▼
                    ┌──────────────┐     ┌─────────────┐
                    │ SSE Service  │     │  Data Layer │
                    │              │     │  (JSON)     │
                    └──────────────┘     └─────────────┘
```

### Komponenten

#### 1. API Layer (index.js)
- Express-basierte REST API
- Route-Definitionen
- Middleware-Integration
- SSE-Endpoint für Live-Updates

#### 2. Service Layer
**SimulationService:**
- Verwaltung des Simulations-Lifecycle
- Orchestrierung von LLM-Aufrufen
- State Management

**LLMService:**
- Kommunikation mit Ollama
- Retry-Logik
- Multi-Modell-Support

#### 3. Repository Layer
**BoardRepository:**
- CRUD für Board-Items (Einsatzstellen)
- Validierung und Schema-Enforcement

**ProtocolRepository:**
- CRUD für Protokolleinträge
- Rückfragen-Erkennung

### Datenfluss

#### Simulation Step:
1. Client → POST /api/sim/step
2. API → SimulationService.step()
3. Service → Repositories (load data)
4. Service → LLMService.callForOps()
5. Service → Repositories (save operations)
6. Service → SSEService.broadcast()
7. Client ← SSE Event

### Design Patterns

- **Repository Pattern:** Datenzugriff abstrahiert
- **Service Pattern:** Business-Logik gekapselt
- **Dependency Injection:** Testbarkeit
- **Observer Pattern:** SSE für Live-Updates
```

**Aufwand:** 6-8 Stunden
**Impact:** Mittel - Onboarding ↑, Wartbarkeit ↑

---

## Zusammenfassung & Zeitplan

### Prioritäten

**Sofort (Woche 1-2):**
1. Konfigurationsmanagement (4-6h)
2. Error Handling (6-8h)
3. SSE-Service (4-6h)
**Total:** ~20 Stunden

**Kurzfristig (Woche 3-6):**
1. Dependency Injection (10-12h)
2. Repository Pattern (12-16h)
3. Input Validation (8-10h)
4. Unit Tests (30-40h)
**Total:** ~70 Stunden

**Mittelfristig (Woche 7-12):**
1. Modulare Architektur (16-20h)
2. Integration Tests (20-30h)
3. JSDoc/TypeScript (6-30h)
4. Performance Monitoring (6-8h)
**Total:** ~70 Stunden

**Langfristig (nach 3 Monaten):**
1. API-Dokumentation (8-10h)
2. Architektur-Docs (6-8h)
3. E2E Tests
4. Caching optimieren

### Gesamtaufwand
- **Minimal (nur kritisch):** 20 Stunden
- **Empfohlen (Phase 1-3):** 160 Stunden (~4 Wochen)
- **Vollständig (alle Phasen):** 200+ Stunden

### ROI-Bewertung

| Phase | Aufwand | Impact | ROI |
|-------|---------|--------|-----|
| 1. Fundamental | 20h | Sehr hoch | ⭐⭐⭐⭐⭐ |
| 2. Struktur | 70h | Sehr hoch | ⭐⭐⭐⭐⭐ |
| 3. Type Safety | 20h | Hoch | ⭐⭐⭐⭐ |
| 4. Testing | 50h | Sehr hoch | ⭐⭐⭐⭐⭐ |
| 5. Performance | 15h | Mittel | ⭐⭐⭐ |
| 6. Docs | 15h | Mittel | ⭐⭐⭐ |

---

## Empfehlung

**Start mit Phase 1** - diese Verbesserungen haben den höchsten Impact bei geringstem Aufwand und legen die Grundlage für alle weiteren Refactorings.

Die modulare Architektur (Phase 2) sollte schrittweise parallel zur Entwicklung neuer Features eingeführt werden, nicht als "Big Bang" Refactoring.
