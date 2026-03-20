// tools/api.js — Generic HTTP API Caller
import { AGENT } from "../config.js";

export const definition = {
  type: "function",
  function: {
    name: "call_api",
    description:
      "Make an HTTP request to any REST API. Supports GET, POST, PUT, DELETE, PATCH with custom headers, JSON body, and query params. Use for: public APIs, webhooks, microservices, local dev servers.",
    parameters: {
      type: "object",
      properties: {
        url:     { type: "string",  description: "API endpoint URL" },
        method:  { type: "string",  enum: ["GET","POST","PUT","DELETE","PATCH"] },
        headers: { type: "object",  description: "Request headers" },
        body:    { type: "object",  description: "JSON request body" },
        params:  { type: "object",  description: "Query string parameters" },
      },
      required: ["url", "method"],
    },
  },
};

export async function execute({ url, method, headers = {}, body, params }) {
  let fullUrl = url;
  if (params) fullUrl += "?" + new URLSearchParams(params).toString();

  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    signal:  AbortSignal.timeout(AGENT.fetchTimeout),
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(fullUrl, opts);
  const ct   = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();

  return { status: res.status, ok: res.ok, data };
}
