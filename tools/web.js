// tools/web.js — Web Search + URL Fetching (100% free, no API keys)
import { AGENT } from "../config.js";
import { remember } from "../memory/vectorstore.js";

export const searchDef = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the internet for any topic. Returns titles, URLs, and snippets. Use for: docs, news, error troubleshooting, finding packages, research.",
    parameters: {
      type: "object",
      properties: {
        query:       { type: "string", description: "Search query" },
        num_results: { type: "number", description: "Number of results (default 6)" },
      },
      required: ["query"],
    },
  },
};

export async function webSearch({ query, num_results = 6 }) {
  const q   = encodeURIComponent(query);
  const res = await fetch(
    `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
    { signal: AbortSignal.timeout(AGENT.bashTimeout) }
  );
  const data    = await res.json();
  const results = [];

  if (data.AbstractText) {
    results.push({ title: data.Heading, url: data.AbstractURL, snippet: data.AbstractText });
  }
  for (const t of (data.RelatedTopics || []).slice(0, num_results - 1)) {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, snippet: t.Text });
    }
  }

  const final = results.slice(0, num_results);
  if (final.length) {
    await remember(`Searched: ${query}`, { type: "task", tags: ["search"] });
  }
  return { query, results: final };
}

export const fetchDef = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch and read the full text content of any public URL. Strips HTML. Use after web_search to read full pages, docs, or articles.",
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
  return { url, status: res.status, content: text };
}
