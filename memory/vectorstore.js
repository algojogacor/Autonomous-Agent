// memory/vectorstore.js — In-RAM Vector Store (16GB DDR5 Optimized)
// Uses Ollama's local embedding model (nomic-embed-text) — 100% free.
// No external service needed. Stores up to 512MB of embeddings in RAM.
// Prevents redundant cloud calls by caching visual/task context.
import fs   from "fs";
import path from "path";
import { OLLAMA_URL, MODELS, AGENT, HARDWARE, WORKING_DIR } from "../config.js";

const STORE_FILE = path.join(WORKING_DIR, ".agent_memory.json");
const MAX_ENTRIES = Math.floor((HARDWARE.ram.vectorStoreMaxMB * 1024 * 1024) / (1536 * 4)); // float32 per dim

// ── In-memory store ──────────────────────────────────
let store = [];   // [{ id, text, embedding: Float32Array, metadata, timestamp }]
let dirty = false;

// Persist to disk every 30 seconds
setInterval(() => { if (dirty) { flush(); dirty = false; } }, 30_000);

function flush() {
  try {
    const serializable = store.map(e => ({
      ...e,
      embedding: Array.from(e.embedding),
    }));
    fs.writeFileSync(STORE_FILE, JSON.stringify(serializable), "utf8");
  } catch {}
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    store = raw.map(e => ({ ...e, embedding: new Float32Array(e.embedding) }));
  } catch {
    store = [];
  }
}

load(); // Load on startup

// ── Embedding via Ollama ─────────────────────────────
async function embed(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model: MODELS.embed, prompt: text }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    const { embedding } = await res.json();
    return new Float32Array(embedding);
  } catch {
    // Fallback: simple hash-based pseudo-embedding (works for exact matches)
    return hashEmbed(text);
  }
}

function hashEmbed(text) {
  // 384-dim pseudo-embedding from character n-grams (deterministic, free)
  const dims = 384;
  const vec  = new Float32Array(dims);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[code % dims]     += 1;
    vec[(code * 7) % dims] += 0.5;
  }
  return normalize(vec);
}

function normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map(v => v / norm);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Public API ───────────────────────────────────────

/**
 * Add a memory entry.
 * @param {string} text - The content to remember
 * @param {object} metadata - { type: 'code'|'error'|'visual'|'task', tags: [], source: '' }
 */
export async function remember(text, metadata = {}) {
  if (!text?.trim()) return;
  const embedding = await embed(text);
  const entry = {
    id:        `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    embedding,
    metadata:  { type: "general", tags: [], ...metadata },
    timestamp: Date.now(),
    accessCount: 0,
  };

  store.push(entry);
  dirty = true;

  // Evict oldest entries if over limit
  if (store.length > MAX_ENTRIES) {
    store.sort((a, b) => a.timestamp - b.timestamp);
    store.splice(0, store.length - MAX_ENTRIES);
  }

  return entry.id;
}

/**
 * Retrieve the top-K most relevant memories.
 * @param {string} query
 * @param {number} k
 * @param {object} filter - { type: 'code' } optional metadata filter
 * @returns {Array<{ text, score, metadata, id }>}
 */
export async function recall(query, k = AGENT.memoryTopK, filter = {}) {
  if (store.length === 0) return [];
  const qEmbed = await embed(query);

  let candidates = store;
  if (filter.type) candidates = store.filter(e => e.metadata.type === filter.type);

  const scored = candidates.map(entry => ({
    ...entry,
    score: cosine(qEmbed, entry.embedding) * Math.pow(AGENT.memoryDecay, (Date.now() - entry.timestamp) / 86400000),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);

  // Update access count
  top.forEach(e => { const orig = store.find(s => s.id === e.id); if (orig) orig.accessCount++; });

  return top.map(({ text, score, metadata, id }) => ({ text, score: +score.toFixed(4), metadata, id }));
}

/**
 * Check if we have a recent memory about this topic (visual cache).
 * Prevents sending redundant screenshots to cloud if screen hasn't changed.
 * @param {string} screenshotHash
 */
export async function checkVisualCache(screenshotHash) {
  const recent = store
    .filter(e => e.metadata.type === "visual" && e.metadata.hash === screenshotHash)
    .filter(e => Date.now() - e.timestamp < 10_000); // within 10 seconds
  return recent.length > 0 ? recent[0] : null;
}

export function stats() {
  return {
    total:     store.length,
    maxEntries: MAX_ENTRIES,
    types:     [...new Set(store.map(e => e.metadata.type))],
    oldestMs:  store.length ? Date.now() - store[0].timestamp : 0,
  };
}

export function clearAll() {
  store = [];
  dirty = true;
  try { fs.unlinkSync(STORE_FILE); } catch {}
}
