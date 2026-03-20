#!/usr/bin/env node

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║    AUTONOMOUS MULTI-AGENT SYSTEM  v3.0  — Hardware Optimized    ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  🎯 Orchestrator  minimax-m2.7:cloud     Task Planning & ReAct  ║
 * ║  👁 Vision        qwen3-vl:235b-cloud    GPU-preproc + OCR      ║
 * ║  🧠 Logic         deepseek-v3.1:671b     RCA + Deep Reasoning   ║
 * ║  💻 Coder         qwen3-coder:480b       Code + Debate          ║
 * ║  🔒 Security      deepseek-v3.1:671b     XSS/Injection Audit    ║
 * ║  ⚡ Performance   qwen3-coder:480b       Profiling              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Hardware: i7-13th | RTX 3050 4GB | 16GB DDR5 | Win11/WSL2      ║
 * ║  Backend : Ollama (localhost) — 100% Free, no API keys           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import readline from "readline";
import { MODELS, OLLAMA_URL, WORKING_DIR, HARDWARE } from "./config.js";
import { runOrchestrator } from "./orchestrator.js";
import { status as gpuStatus } from "./hardware/gpu.js";
import { poolStatus } from "./hardware/threads.js";
import { stats as memStats } from "./memory/vectorstore.js";
import { stats as kgStats }  from "./memory/knowledge_graph.js";
import { stats as prefStats } from "./memory/preferences.js";

export const C = {
  reset:   "\x1b[0m",  bold:    "\x1b[1m",  dim:     "\x1b[2m",
  cyan:    "\x1b[36m", green:   "\x1b[32m", yellow:  "\x1b[33m",
  red:     "\x1b[31m", magenta: "\x1b[35m", blue:    "\x1b[34m",
  white:   "\x1b[37m", gray:    "\x1b[90m",
};

export const log = (prefix, color, ...args) =>
  console.log(`${color}${C.bold}${prefix}${C.reset}`, ...args);

// ── Startup Checks ───────────────────────────────────
async function checkOllama() {
  try {
    const res  = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    return { ok: true, models: data.models?.map(m => m.name) || [] };
  } catch {
    return { ok: false, models: [] };
  }
}

async function printStartup() {
  console.clear();

  const [ollama, gpu] = await Promise.all([
    checkOllama(),
    Promise.resolve(gpuStatus()),
  ]);

  const pool = poolStatus();
  const mem  = memStats();
  const kg   = kgStats();
  const pref = prefStats();

  console.log(`${C.cyan}${C.bold}
╔══════════════════════════════════════════════════════════════════╗
║    AUTONOMOUS MULTI-AGENT SYSTEM  v3.0  — Hardware Optimized    ║
╠══════════════════════════════════════════════════════════════════╣
║  🎯 ${MODELS.orchestrator.padEnd(59)}║
║  👁 ${MODELS.vision.padEnd(59)}║
║  🧠 ${MODELS.logic.padEnd(59)}║
║  💻 ${MODELS.coder.padEnd(59)}║
╠══════════════════════════════════════════════════════════════════╣
║  HARDWARE STATUS                                                 ║
║  Ollama  : ${(ollama.ok ? "✓ Connected  " : "✗ Not found  ").padEnd(52)}║
║  GPU     : ${(gpu.gpu ? `✓ RTX 3050  sharp=${gpu.sharp ? "✓" : "✗"}  ocr=${gpu.tesseract ? "✓" : "✗"}` : "✗ Disabled").padEnd(52)}║
║  Threads : ${`✓ ${pool.maxWorkers} workers  (i7 P-cores)`.padEnd(52)}║
║  MEMORY STATUS                                                   ║
║  Vectors : ${`${mem.total} entries  (${mem.total > 0 ? "loaded" : "empty"})`.padEnd(52)}║
║  Graph   : ${`${kg.nodes} nodes  ${kg.edges} edges`.padEnd(52)}║
║  Prefs   : ${`${pref.corrections} corrections  ${pref.learned} learned`.padEnd(52)}║
╚══════════════════════════════════════════════════════════════════╝${C.reset}`);

  if (!ollama.ok) {
    log("\n⚠ Ollama not running. Start it with:", C.yellow, "ollama serve");
  } else {
    const needed  = Object.values(MODELS).filter(m => m !== MODELS.embed);
    const missing = needed.filter(m => !ollama.models.includes(m));
    if (missing.length) {
      log(`\n⚠ Models not pulled:`, C.yellow, missing.join(", "));
      log(`  Pull with:`, C.gray, `ollama pull <model>`);
    } else {
      log(`\n✓ All models ready.`, C.green);
    }
  }

  console.log(`\n${C.gray}CWD: ${WORKING_DIR}${C.reset}`);
  console.log(`${C.gray}Commands: exit | clear | status | help | correct <category> <original> → <fix>${C.reset}\n`);
}

// ── Help Text ─────────────────────────────────────────
function printHelp() {
  console.log(`
${C.cyan}${C.bold}Available Commands:${C.reset}
  ${C.yellow}exit${C.reset}                   Quit
  ${C.yellow}clear${C.reset}                  Reset conversation history
  ${C.yellow}status${C.reset}                 Show hardware + memory stats
  ${C.yellow}help${C.reset}                   Show this help

${C.cyan}${C.bold}Preference Learning:${C.reset}
  ${C.yellow}correct library axios → got${C.reset}    Tell agent you prefer 'got' over 'axios'
  ${C.yellow}correct style tabs → spaces${C.reset}    Teach coding style preference

${C.cyan}${C.bold}Example Prompts:${C.reset}
  Search Tokopedia for "RTX 3050" and save top 5 prices to prices.csv
  Write a Puppeteer scraper for shopee.co.id product listings
  Look at my screen and click the Chrome icon
  Audit my ./src folder for XSS vulnerabilities
  Profile server.js and find memory leaks
  Fix the crash in app.js — TypeError: Cannot read properties of undefined
  Build a WhatsApp bot using Baileys that replies automatically
  Run npm test and npm lint at the same time
`);
}

// ── Main ─────────────────────────────────────────────
async function main() {
  await printStartup();

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: true,
  });

  const history = [];

  const prompt = () => {
    rl.question(`\n${C.cyan}${C.bold}You: ${C.reset}`, async (input) => {
      const t = input.trim();
      if (!t) return prompt();

      // ── Built-in commands ──
      if (t === "exit") {
        log("\nGoodbye! 👋", C.cyan);
        rl.close();
        return;
      }

      if (t === "clear") {
        history.length = 0;
        log("✓ Conversation cleared.", C.yellow);
        return prompt();
      }

      if (t === "status") {
        const gpu  = gpuStatus();
        const pool = poolStatus();
        const mem  = memStats();
        const kg   = kgStats();
        console.log(`\n${C.cyan}${C.bold}System Status:${C.reset}`);
        console.log(`  GPU    : sharp=${gpu.sharp} | ocr=${gpu.tesseract}`);
        console.log(`  Threads: ${pool.active}/${pool.maxWorkers} active, ${pool.queued} queued`);
        console.log(`  Memory : ${mem.total} vectors | types: ${mem.types.join(", ")}`);
        console.log(`  Graph  : ${kg.nodes} nodes, ${kg.edges} edges`);
        return prompt();
      }

      if (t === "help") {
        printHelp();
        return prompt();
      }

      // Preference correction: "correct library axios → got"
      const correctMatch = t.match(/^correct\s+(\w+)\s+(.+?)\s*(?:→|->|>)\s*(.+)$/i);
      if (correctMatch) {
        const [, category, original, correction] = correctMatch;
        const { logCorrection } = await import("./memory/preferences.js");
        logCorrection(category, original, correction);
        log(`✓ Learned: prefer "${correction}" over "${original}" [${category}]`, C.green);
        return prompt();
      }

      // ── Run the agent ──
      try {
        await runOrchestrator({ userMessage: t, history, rl, C, log });
      } catch (err) {
        log("\n✗ Error:", C.red, err.message);
        console.error(err.stack);
      }

      prompt();
    });
  };

  prompt();
}

main();