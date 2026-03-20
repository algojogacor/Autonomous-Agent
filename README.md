# 🤖 Autonomous Multi-Agent System v3.0
### Hardware-Optimized | 100% Free | Ollama Powered

Tuned for: **i7-13th Gen | RTX 3050 4GB VRAM | 16GB DDR5 | Windows 11/WSL2**

---

## Architecture

```
You
 │
 ▼
🎯 Orchestrator  (minimax-m2.7:cloud)
   ReAct Loop · Plan Auditor · Memory Retrieval · Confidence Gating
   │
   ├─► 👁  Vision Agent      (qwen3-vl:235b-cloud)
   │       RTX 3050 GPU compresses screenshots → Cloud analyzes coordinates
   │       Local Tesseract OCR for instant text reading (no cloud call)
   │       Visual cache prevents redundant cloud calls for unchanged screens
   │
   ├─► 💻  Coder Agent       (qwen3-coder:480b-cloud)
   │       Writes & runs code in any language
   │       Auto-triggers Adversarial Debate for complex tasks
   │
   ├─► 🧠  Logic Agent       (deepseek-v3.1:671b-cloud)
   │       Deep research · Root Cause Analysis · Self-correction
   │       Used in debate reviews + plan auditing
   │
   ├─► 🔒  Security Agent    (deepseek-v3.1:671b-cloud)
   │       XSS/SQLi scanning · OWASP Top 10 · Secret detection
   │
   └─► ⚡  Performance Agent (qwen3-coder:480b-cloud)
           CPU/memory profiling · Query optimization · Bottleneck analysis
```

---

## Key Features

### 🔁 ReAct Loop (Reason + Act)
Every agent explicitly states a `THOUGHT` before every `ACTION`.
Forces step-by-step reasoning rather than blind tool calling.

### 🧠 Self-Correction Engine
- **Plan Auditor**: Logic agent reviews Orchestrator's plan *before* execution
- **Root Cause Analysis**: On any failure, DeepSeek traces the exact error source
- **Auto-Retry**: Up to 3 retries with RCA-guided patches

### ⚔️ Adversarial Debate
Complex coding tasks are sent to *both* Coder and Logic simultaneously.
They review each other's code, debate, and reach consensus. Orchestrator arbitrates if needed.

### 🧩 Persistent Memory
- **Vector Store**: Embeddings in 16GB DDR5 RAM via Ollama's local embed model
- **Knowledge Graph**: Maps project facts (`Baileys requires auth_state`)
- **Preference Learning**: Logs corrections (`prefer Express over Fastify`)

### 🛡️ Human-in-the-Loop
- Confidence scored (0–100%) before risky tasks
- Below 70% → pauses and asks you
- Destructive commands (`rm -rf`, force-push) always require confirmation

### ⚡ Hardware Optimization
- **GPU**: `sharp` + libvips compresses 4K screenshots to ~150KB before cloud upload
- **OCR**: Tesseract runs locally on RTX 3050 — no cloud call for text reading
- **CPU**: i7 P-cores run bash commands in parallel worker threads
- **RAM**: Visual cache skips cloud vision if screen unchanged in last 10s

---

## Quick Start

```bash
# 1. Start Ollama
ollama serve

# 2. Pull the 4 models (one-time)
ollama pull minimax-m2.7:cloud
ollama pull qwen3-vl:235b-cloud
ollama pull deepseek-v3.1:671b-cloud
ollama pull qwen3-coder:480b-cloud
ollama pull nomic-embed-text        # local embeddings (small, fast)

# 3. Install GPU libs (optional but recommended)
npm install

# 4. Run
node index.js
```

---

## File Structure

```
index.js                  ← CLI entry point
config.js                 ← All models, hardware tuning, limits
orchestrator.js           ← Master coordinator

agents/
  base.js                 ← Ollama API caller (shared)
  vision.js               ← 👁 GPU-accelerated vision
  coder.js                ← 💻 Code generation + debate
  logic.js                ← 🧠 Deep reasoning + RCA
  security.js             ← 🔒 Security audit
  performance.js          ← ⚡ Performance profiling

core/
  react_loop.js           ← ReAct (Thought→Action→Observation) engine
  self_correct.js         ← Plan auditor + Root Cause Analysis
  uncertainty.js          ← Confidence scoring + HITL gates
  debate.js               ← Adversarial debate engine

hardware/
  gpu.js                  ← RTX 3050: sharp image compression + Tesseract OCR
  threads.js              ← i7 P-core worker thread pool
  worker_exec.js          ← Worker thread bash executor

memory/
  vectorstore.js          ← In-RAM vector DB (Ollama embeddings)
  knowledge_graph.js      ← Personal knowledge graph
  preferences.js          ← User preference learning

tools/
  index.js                ← Master tool registry
  bash.js                 ← Shell (single + parallel)
  files.js                ← read/write/patch/list
  web.js                  ← DuckDuckGo search + URL fetch
  api.js                  ← HTTP API caller
  gui.js                  ← Screenshot, mouse, keyboard (Win11/WSL2/Linux)
  memory_tools.js         ← Memory as agent tools
```

---

## Configuration (`config.js`)

```js
export const MODELS = {
  orchestrator: "minimax-m2.7:cloud",
  vision:       "qwen3-vl:235b-cloud",
  logic:        "deepseek-v3.1:671b-cloud",
  coder:        "qwen3-coder:480b-cloud",
  fast:         "glm-4.6:cloud",        // Quick classifications
  embed:        "nomic-embed-text",     // Local embeddings
};

export const HARDWARE = {
  gpu: {
    screenshotMaxPx: 1024,    // Resize target (px)
    screenshotQuality: 80,    // JPEG quality
    useLocalOCR: true,        // Tesseract before cloud
  },
  cpu: {
    workerThreads: 6,         // P-core count
  },
};

export const AGENT = {
  uncertaintyThreshold: 0.70, // Below this → ask user
  maxDebateRounds: 3,
  maxRetries: 3,
};
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `exit`  | Quit |
| `clear` | Reset conversation |
| `status` | Hardware + memory diagnostics |
| `help`  | Show all commands + examples |
| `correct library axios → got` | Teach a preference |

---

## Example Prompts

```
> Search Tokopedia for "RTX 3050" and save top 5 prices to prices.csv
> Build a WhatsApp bot using Baileys that auto-replies "Hi! I'm busy"
> Look at my screen, find the VS Code icon and open it
> Audit my ./src folder for XSS vulnerabilities
> Run npm test and npm lint in parallel
> Fix the crash in server.js — TypeError: Cannot read properties of undefined
> Profile app.js and tell me what's causing the memory leak
> Research the latest Puppeteer API and write a scraper for shopee.co.id
```

---

## Dependencies

| Package | Purpose | Required? |
|---------|---------|-----------|
| `sharp` | GPU-accelerated image compression (RTX 3050) | Optional (auto-fallback) |
| `tesseract.js` | Local OCR (no cloud needed for text reading) | Optional (auto-fallback) |

All other functionality uses **Node.js built-ins** + **native fetch** (Node 18+).
No API keys. No subscriptions. 100% local.
