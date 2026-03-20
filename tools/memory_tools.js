// tools/memory_tools.js — Memory & Knowledge Tools exposed as agent tools
import { remember, recall, stats as vstats } from "../memory/vectorstore.js";
import { learn, query, getRelevantFacts, stats as kgstats } from "../memory/knowledge_graph.js";
import { set as setPref, logCorrection, all as allPrefs } from "../memory/preferences.js";

export const saveDef = {
  type: "function",
  function: {
    name: "save_progress",
    description: "Save a note or intermediate result to long-term memory. Use for tracking multi-step tasks, storing found URLs, file paths, or partial results.",
    parameters: {
      type: "object",
      properties: {
        text:     { type: "string", description: "What to remember" },
        type:     { type: "string", enum: ["task","code","error","visual","general"], description: "Memory type" },
        tags:     { type: "array",  items: { type: "string" }, description: "Optional tags" },
      },
      required: ["text"],
    },
  },
};

export async function saveProgress({ text, type = "general", tags = [] }) {
  const id = await remember(text, { type, tags });
  return { success: true, id };
}

export const recallDef = {
  type: "function",
  function: {
    name: "recall_memory",
    description: "Search long-term memory for relevant past experiences, solutions, or context.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        type:  { type: "string", description: "Filter by memory type (optional)" },
        k:     { type: "number", description: "How many results (default 5)" },
      },
      required: ["query"],
    },
  },
};

export async function recallMemory({ query: q, type, k }) {
  const results = await recall(q, k || 5, type ? { type } : {});
  return { results };
}

export const learnDef = {
  type: "function",
  function: {
    name: "learn_fact",
    description: "Add a fact to the knowledge graph. e.g. 'Baileys requires auth_state', 'User prefers Express over Fastify'.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        verb:    { type: "string" },
        object:  { type: "string" },
        context: { type: "string" },
      },
      required: ["subject", "verb", "object"],
    },
  },
};

export async function learnFact({ subject, verb, object, context }) {
  learn(subject, verb, object, context);
  return { success: true, fact: `${subject} ${verb} ${object}` };
}

export const queryKgDef = {
  type: "function",
  function: {
    name: "query_knowledge",
    description: "Query the knowledge graph about a topic. Returns known facts and relationships.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
    },
  },
};

export async function queryKnowledge({ topic }) {
  return query(topic) || { message: "No knowledge found for this topic" };
}
