// ═══════════════════════════════════════════════════════════════
//  config.js  —  Hardware-Aware Central Configuration
//  Tuned for: i7-13th Gen | RTX 3050 4GB | 16GB DDR5 | Win11/WSL2
// ═══════════════════════════════════════════════════════════════

export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// ── Model Registry ───────────────────────────────────────────
export const MODELS = {
  orchestrator: process.env.MODEL_ORCHESTRATOR || "minimax-m2.7:cloud",   // Manager
  vision:       process.env.MODEL_VISION       || "qwen3-vl:235b-cloud",  // Eyes
  logic:        process.env.MODEL_LOGIC        || "deepseek-v3.1:671b-cloud", // Brain
  coder:        process.env.MODEL_CODER        || "qwen3-coder:480b-cloud",   // Hands
  fast:         process.env.MODEL_FAST         || "glm-4.6:cloud",            // Quick tasks
  embed:        process.env.MODEL_EMBED        || "nomic-embed-text",          // Embeddings (local)
};

// ── Hardware Profile ─────────────────────────────────────────
export const HARDWARE = {
  // RTX 3050 4GB — used for image preprocessing via sharp/CUDA
  gpu: {
    enabled:       true,
    vram:          4096,    // MB
    // Image resize target before sending to cloud vision
    screenshotMaxPx: 1024,  // px (long side)
    screenshotQuality: 80,  // JPEG quality
    useLocalOCR:   true,    // Run Tesseract locally before cloud call
  },

  // i7-13th Gen — P-core / E-core hybrid
  cpu: {
    workerThreads: 6,       // Use 6 P-cores for parallel bash tasks
    bashParallel:  true,    // Allow concurrent shell commands
  },

  // 16GB DDR5 — leave 4GB headroom for OS + Ollama
  ram: {
    vectorStoreMaxMB: 512,  // Max RAM for in-memory vector store
    contextBufferMB:  256,  // Conversation history buffer
  },
};

// ── Agent Behaviour ──────────────────────────────────────────
export const AGENT = {
  maxIterations:      40,   // Max tool-call turns per agent
  maxDelegations:     15,   // Max sub-agent calls per orchestrator run
  maxDebateRounds:    3,    // Coder vs Logic adversarial debate rounds
  bashTimeout:        60000,
  fetchTimeout:       15000,

  // Self-correction
  maxRetries:         3,    // Auto-retry on tool failure
  rcaEnabled:         true, // Root Cause Analysis on failures

  // Human-in-the-Loop thresholds
  uncertaintyThreshold: 0.70,  // Below this → ask user
  destructiveConfirm:   true,  // Always confirm rm -rf, force-push, etc.

  // Memory
  memoryTopK:         5,    // How many memories to retrieve per query
  memoryDecay:        0.95, // Relevance decay for old memories
};

export const WORKING_DIR = process.env.AGENT_WORKDIR || process.cwd();
