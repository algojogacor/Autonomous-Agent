// tools/web.js — Web Search + URL Fetching
//
// Search priority:
//   1. Tavily AI Search  — free 1000/month, best for AI agents, instant results
//      Get key: https://tavily.com → Sign up free
//   2. Ollama Native     — needs OLLAMA_API_KEY
//   3. Brave Search      — reliable fallback
//   4. DuckDuckGo        — last resort
//
// Set key: $env:TAVILY_API_KEY="tvly-xxxxx"

import { AGENT } from "../config.js";

const TAVILY_KEY    = process.env.TAVILY_API_KEY    || "";
const OLLAMA_KEY    = process.env.OLLAMA_API_KEY    || "";

export const searchDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the internet. Fast and accurate. Use for: news, data, lists, prices, documentation, current events.",
    parameters: {
      type: "object",
      properties: {
        query:       { type: "string", description: "Search query" },
        num_results: { type: "number", description: "Number of results (default 8)" },
      },
      required: ["query"],
    },
  },
};

export async function webSearch({ query, num_results = 8 }) {
  // ── 1. Tavily (best for AI agents) ──────────────────
  if (TAVILY_KEY) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          api_key:              TAVILY_KEY,
          query,
          max_results:          num_results,
          include_answer:       true,
          include_raw_content:  true,   // Get full content for richer data
          search_depth:         "advanced", // Deep search = more data
        }),
        signal: AbortSignal.timeout(AGENT.fetchTimeout),
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results || []).map(r => ({
          title:   r.title,
          url:     r.url,
          content: r.content || r.snippet || "",
        }));
        return {
          query,
          source:  "tavily",
          answer:  data.answer || "",   // Tavily gives direct answer too
          results: results.slice(0, num_results),
        };
      }
    } catch {}
  }

  // ── 2. Ollama Native ─────────────────────────────────
  if (OLLAMA_KEY) {
    try {
      const res = await fetch("https://ollama.com/api/web_search", {
        method:  "POST",
        headers: { "Authorization": `Bearer ${OLLAMA_KEY}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ query, max_results: num_results }),
        signal:  AbortSignal.timeout(AGENT.fetchTimeout),
      });
      if (res.ok) {
        const data = await res.json();
        return { query, source: "ollama", results: (data.results || []).slice(0, num_results) };
      }
    } catch {}
  }

  // ── 3. Brave Search ──────────────────────────────────
  try {
    const q   = encodeURIComponent(query);
    const res = await fetch(
      `https://search.brave.com/search?q=${q}&format=json`,
      {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
        signal:  AbortSignal.timeout(AGENT.fetchTimeout),
      }
    );
    if (res.ok) {
      const data    = await res.json();
      const results = (data.web?.results || []).slice(0, num_results).map(r => ({
        title:   r.title,
        url:     r.url,
        content: r.description || "",
      }));
      if (results.length) return { query, source: "brave", results };
    }
  } catch {}

  // ── 4. DuckDuckGo ────────────────────────────────────
  try {
    const q   = encodeURIComponent(query);
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(AGENT.fetchTimeout) }
    );
    if (res.ok) {
      const data    = await res.json();
      const results = [];
      if (data.AbstractText) {
        results.push({ title: data.Heading, url: data.AbstractURL, content: data.AbstractText });
      }
      for (const t of (data.RelatedTopics || []).slice(0, num_results - 1)) {
        if (t.Text && t.FirstURL) {
          results.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, content: t.Text });
        }
      }
      if (results.length) return { query, source: "duckduckgo", results };
    }
  } catch {}

  return {
    query,
    source:  "all-failed",
    results: [],
    error:   "All search engines failed. Use fetch_url directly with a known URL instead.",
  };
}

export const fetchDef = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch and read the full text content of any URL. Strips HTML. " +
      "Use to read full articles, Wikipedia, school databases, government sites.",
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
  if (OLLAMA_KEY) {
    try {
      const res = await fetch("https://ollama.com/api/web_fetch", {
        method:  "POST",
        headers: { "Authorization": `Bearer ${OLLAMA_KEY}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ url }),
        signal:  AbortSignal.timeout(AGENT.fetchTimeout),
      });
      if (res.ok) {
        const data = await res.json();
        return { url, source: "ollama", title: data.title || "", content: data.content || "" };
      }
    } catch {}
  }

  try {
    const res  = await fetch(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(AGENT.fetchTimeout),
    });
    let text = await res.text();
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);
    return { url, source: "raw-fetch", status: res.status, content: text };
  } catch (err) {
    return { url, source: "error", content: "", error: err.message };
  }
}