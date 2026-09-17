import assert from "node:assert/strict";
import { it } from "node:test";
import { JevClient } from "../src/jev/client.js";
import { getJevApiKey } from "../src/config/environment.js";
import type { JevQuestions } from "../src/evaluation/questions.js";

const questions: JevQuestions = {
  relevant: { type: "noul", instructions: "Is it relevant?", criteria: { true: "yes", false: "no" } },
  quality: { type: "score", instructions: "Rate quality", criteria: ["poor", "good"] },
  issue: { type: "choice", instructions: "Pick issue", criteria: { none: "No issue", bug: "Bug" } }
};
const answers = { relevant: { noul: 0.9 }, quality: { score: 1, confidence: 0.8 }, issue: { choice: "none", confidence: 0.7 } };
function completion(content: unknown, finish = "stop") {
  return { model: "anthropic/claude-sonnet-4.6", choices: [{ message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
}

it("reads the user's exported gateway key and never falls back to TypeSafe", () => {
  assert.equal(getJevApiKey({ VERCEL_AI_GATEWAY: " secret " }), "secret");
  assert.throws(() => getJevApiKey({ JEV_API_KEY: "old" }), /VERCEL_AI_GATEWAY/);
});

it("sends chat messages and a strict schema to Gateway, then adapts validated answers", async () => {
  const client = new JevClient({ apiKey: "secret", fetchImplementation: async (url, init) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
    const body = JSON.parse(String(init?.body));
    assert.equal(JSON.stringify(body).includes("secret"), false);
    assert.equal(body.messages[0].role, "system");
    assert.deepEqual(JSON.parse(body.messages[1].content).state, { diff: "change" });
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.required, ["relevant", "quality", "issue"]);
    return Response.json(completion(answers));
  } });
  const result = await client.evaluate({ diff: "change" }, questions);
  assert.deepEqual(result.answers.relevant, { type: "noul", noul: 0.9 });
  assert.deepEqual(result.answers.quality, { type: "score", score: 1, confidence: 0.8, probabilities: {}, legend: { "0": "poor", "1": "good" } });
  assert.equal(result.answers.issue?.type, "choice");
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 20 });
});

for (const [name, content, finish] of [
  ["missing answers", {}, "stop"],
  ["unknown choice", { ...answers, issue: { choice: "invented", confidence: 0.8 } }, "stop"],
  ["out-of-range score", { ...answers, quality: { score: 10, confidence: 0.8 } }, "stop"],
  ["truncated output", answers, "length"]
] as const) {
  it(`rejects ${name}`, async () => {
    const client = new JevClient({ apiKey: "secret", fetchImplementation: async () => Response.json(completion(content, finish)) });
    await assert.rejects(client.evaluate({}, questions), /Gateway/);
  });
}

it("honors an explicitly selected Gateway model", async () => {
  let selected = "";
  const client = new JevClient({ apiKey: "secret", model: " provider/model ", fetchImplementation: async (_url, init) => {
    selected = JSON.parse(String(init?.body)).model;
    return Response.json(completion(answers));
  } });
  await client.evaluate({}, questions);
  assert.equal(selected, "provider/model");
});

for (const status of [401, 403, 402]) {
  it(`reports HTTP ${status} without retrying or exposing upstream secrets`, async () => {
    let calls = 0;
    const client = new JevClient({ apiKey: "secret", fetchImplementation: async () => {
      calls++;
      return Response.json({ error: { message: "secret" } }, { status });
    } });
    await assert.rejects(client.evaluate({}, questions), (error: Error) => {
      assert.equal(error.message.includes("secret"), false);
      assert.match(error.message, status === 402 ? /credits/ : /VERCEL_AI_GATEWAY/);
      return true;
    });
    assert.equal(calls, 1);
  });
}

it("rejects invalid JSON, refusals, and absent content without leaking the response", async () => {
  for (const body of ["secret", { choices: [{ message: { refusal: "secret", content: null }, finish_reason: "stop" }] }]) {
    const client = new JevClient({ apiKey: "secret", fetchImplementation: async () => new Response(typeof body === "string" ? body : JSON.stringify(body)) });
    await assert.rejects(client.evaluate({}, questions), (error: Error) => {
      assert.match(error.message, /invalid structured review/);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  }
});
