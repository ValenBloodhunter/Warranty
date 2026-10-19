"use strict";

const crypto = require("node:crypto");

const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";

function reply(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(payload);
}

function tokenMatches(candidate, expected) {
  if (typeof candidate !== "string" || !expected) return false;

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);

  return candidateBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(candidateBytes, expectedBytes);
}

module.exports = async function chat(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Use POST." });
  }

  const demoToken = process.env.WARRANTY_DEMO_TOKEN;
  if (!demoToken) {
    return reply(res, 503, {
      error: "Live routing is not configured. Set the server environment variables."
    });
  }

  const authorization = req.headers.authorization || "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!tokenMatches(suppliedToken, demoToken)) {
    return reply(res, 401, { error: "The access code is missing or incorrect." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return reply(res, 503, {
      error: "The model provider is not configured on the server."
    });
  }

  const prompt = typeof req.body?.prompt === "string"
    ? req.body.prompt.trim()
    : "";
  const route = req.body?.route;
  const messages = Array.isArray(req.body?.messages)
    ? req.body.messages
    : [{ role: "user", content: prompt }];

  if (!prompt || prompt.length > 6000) {
    return reply(res, 400, {
      error: "Enter a prompt between 1 and 6,000 characters."
    });
  }

  if (route !== "cheap" && route !== "frontier") {
    return reply(res, 400, { error: "Route must be cheap or frontier." });
  }

  if (
    messages.length < 1 ||
    messages.length > 13 ||
    !messages.every(message =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.length > 0 &&
      message.content.length <= 6000
    ) ||
    messages[messages.length - 1]?.role !== "user" ||
    messages[messages.length - 1]?.content !== prompt ||
    messages.reduce((total, message) => total + message.content.length, 0) > 24000
  ) {
    return reply(res, 400, { error: "Conversation is too long or has an invalid message." });
  }

  const model = route === "cheap"
    ? process.env.WARRANTY_CHEAP_MODEL || "openai/gpt-oss-20b"
    : process.env.WARRANTY_FRONTIER_MODEL || "openai/gpt-oss-120b";

  try {
    const upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://warranty-liart.vercel.app",
        "X-Title": "WARRANTY"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1200,
        temperature: 0.2
      })
    });

    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) {
        return reply(res, 502, { error: "The provider rejected its server credentials." });
      }
      if (upstream.status === 429) {
        return reply(res, 429, { error: "The provider rate limit or account limit was reached." });
      }
      return reply(res, 502, { error: "The model provider could not complete this request." });
    }

    const result = await upstream.json();
    const answer = result.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return reply(res, 502, { error: "The provider returned no text answer." });
    }

    return reply(res, 200, {
      answer,
      model: result.model || model,
      usage: result.usage || null
    });
  } catch (_) {
    return reply(res, 502, { error: "Could not reach the model provider." });
  }
};
