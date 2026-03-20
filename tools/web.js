// tools/web.js — Web Search + URL Fetching
//
// Priority:
//   1. Ollama Native Web Search API (https://ollama.com/api/web_search)
//      → Requires OLLAMA_API_KEY (free, 100/day from ollama.com account)
//      → Best quality results, returns title + url + content snippet
//   2. DuckDuckGo Instant Answer API (fallback, no key needed, always free)
//
// To enable Ollama native search:
//   set OLLAMA_API_KEY=your_key_here   (PowerShell)
//   Then restart: node index.js
//
import { AGENT } from "../config.js";

const OLLAMA_API_KEY    = process.env.OLLAMA_API_KEY || "";
const OLLAMA_SEARCH_URL = "https://ollama.com/api/web_search";
const OLLAMA_FETCH_URL  = "https://ollama.com/api/web_fetch";

// ── web_search tool definition ────────────────────────
export const searchDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the internet for any topic. Returns titles, URLs, and content snippets. " +
      "Use for: documentation, news, troubleshooting errors, research, finding packages, prices, current events.",
    parameters: {
      type: "object",
      properties: {
        query:       { type: "string", description: "Search query" },
        num_results: { type: "number", description: "Number of results to return (default 6)" },
      },
      required: ["query"],
    },
  },
};

export async function webSearch({ query, num_results = 6 }) {
  // ── Strategy 1: Ollama Native Search API ────────────
  if (OLLAMA_API_KEY) {
    try {
      const res = await fetch(OLLAMA_SEARCH_URL, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
          "Content-Type":  "application/json",
        },
        body:   JSON.stringify({ query, max_results: num_results }),
        signal: AbortSignal.timeout(AGENT.fetchTimeout),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          query,
          source:  "ollama-native",
          results: (data.results || []).slice(0, num_results),
        };
      }
    } catch {
      // fall through to DuckDuckGo
    }
  }

  // ── Strategy 2: DuckDuckGo (free fallback) ──────────
  try {
    const q    = encodeURIComponent(query);
    const res  = await fetch(
      `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(AGENT.fetchTimeout) }
    );
    const data    = await res.json();
    const results = [];

    if (data.AbstractText) {
      results.push({
        title:   data.Heading,
        url:     data.AbstractURL,
        content: data.AbstractText,
      });
    }

    for (const t of (data.RelatedTopics || []).slice(0, num_results - 1)) {
      if (t.Text && t.FirstURL) {
        results.push({
          title:   t.Text.split(" - ")[0],
          url:     t.FirstURL,
          content: t.Text,
        });
      }
    }

    return {
      query,
      source:  "duckduckgo",
      results: results.slice(0, num_results),
    };
  } catch (err) {
    return { query, source: "error", results: [], error: err.message };
  }
}

// ── fetch_url tool definition ─────────────────────────
export const fetchDef = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch and read the full text content of any public URL. " +
      "Strips HTML noise. Use after web_search to read full pages, docs, articles, or price listings.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to fetch" },
      },
      required: ["url"],
    },
  },
};

export async function fetchUrl({ url }) {
  // ── Strategy 1: Ollama Native Fetch API (returns clean markdown) ──
  if (OLLAMA_API_KEY) {
    try {
      const res = await fetch(OLLAMA_FETCH_URL, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
          "Content-Type":  "application/json",
        },
        body:   JSON.stringify({ url }),
        signal: AbortSignal.timeout(AGENT.fetchTimeout),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          url,
          source:  "ollama-native",
          title:   data.title   || "",
          content: data.content || "",
          links:   data.links   || [],
        };
      }
    } catch {
      // fall through
    }
  }

  // ── Strategy 2: Raw HTML fetch + strip ──────────────
  try {
    const res  = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AIAgent/1.0)" },
      signal:  AbortSignal.timeout(AGENT.fetchTimeout),
    });
    let text = await res.text();
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
    return { url, source: "raw-fetch", status: res.status, content: text };
  } catch (err) {
    return { url, source: "error", content: "", error: err.message };
  }
}