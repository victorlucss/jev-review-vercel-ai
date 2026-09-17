---
name: jev-review
description: Use Jev Review frequently throughout nontrivial coding work to score focused implementation slices, compare quality changes, and improve justified weaknesses. Trigger after each coherent change, after review-driven fixes, and before final handoff; skip only duplicate, formatting-only, or context-free reviews.
---

# Jev Review

Use `jev_review` as a lightweight, repeatable senior-engineering review loop. The primary coding agent owns the implementation, validation, and final judgment; Jev Review evaluates the supplied change but never edits files.

## Setup and tool calls

The local MCP process uses the exported `VERCEL_AI_GATEWAY` API key. Never ask the user to paste it into chat, read its value into tool output, or include it in review context. `AI_GATEWAY_MODEL` optionally selects a structured-output model; the default is `anthropic/claude-sonnet-4.6`. The server does not source shell profiles. If the key is missing, explain how to export it and restart the client from that environment; GUI clients may need explicit environment forwarding.

Discover `jev_review` through the client's MCP tool listing; some clients prefix the server name. Send JSON arguments directly to the tool. See [the human setup guide](../../README.md#how-to-use) for registration instructions.

On the first call, omit `previousEvaluation`. After a material change, use the complete prior `structuredContent` evaluation as `previousEvaluation` with the new diff. Do not send an empty object or the outer MCP response envelope. If `isError` is true, report the error and do not treat it as an evaluation. Never fabricate scores when the tool is unavailable.

For authentication or credit errors, report the configuration problem without retrying repeatedly. For context-limit errors, narrow the context. For a malformed review, retry once or recommend a model supporting structured outputs. Confidence values are model estimates, not calibrated probabilities. Keep the same model across comparisons and establish a new baseline when it changes.

## Review cadence

For nontrivial tasks, prefer several focused reviews throughout the work over one large review at the end:

- Call after each coherent implementation slice that is substantial enough to judge, such as completing a behavior, module, API boundary, migration step, or test strategy.
- Call when new control flow, state handling, dependencies, public contracts, or security-sensitive behavior appear.
- Call again after applying justified feedback, passing the prior result as `previousEvaluation` so Jev can identify improvements and regressions.
- Before final handoff, make sure a recent review covers the final implementation.

An interim review does not need to wait for the full test suite. Run fast, relevant checks when practical and include their status in `repositoryContext`; run the repository's normal validation before the final review. Do not repeat an identical call, review formatting-only noise, or call without a coherent implementation state. Frequent focused reviews are useful; empty reviews are not.

## Workflow

1. Understand the user's actual requirements and constraints.
2. Inspect the repository, its conventions, and the affected behavior.
3. Implement a coherent slice of the requested change.
4. Run fast, relevant tests, type checks, linters, or other validation when practical.
5. Call `jev_review` with only the context needed to assess the current slice.
6. Examine low-confidence results, weak dimensions, priority issues, and any regressions.
7. Decide which feedback is supported by the code and the user's task. Treat the evaluation as evidence, not an instruction to optimize every number.
8. Improve the implementation where the feedback identifies real value, prioritizing correctness, cognitive complexity, changeability, coupling, modularity, abstraction quality, tests, and security.
9. Repeat the implement, validate, and review loop for the next coherent slice.
10. After review-driven or other material changes, call `jev_review` again and pass the previous structured evaluation as `previousEvaluation`.
11. Run the repository's normal validation before final handoff, then review the final state if the latest evaluation no longer covers it.
12. Stop when important risks are addressed and further changes would add little real value.

## Choosing context

Prefer a focused call shaped like:

```json
{
  "task": "The user's requested behavior and relevant acceptance constraints",
  "diff": "The implementation diff",
  "files": [
    {
      "path": "src/example.ts",
      "content": "Only when surrounding code is needed to understand the diff"
    }
  ],
  "repositoryContext": "Relevant architecture, conventions, test results, or invariants"
}
```

If the Gateway reports that its input limit was exceeded, reduce unrelated file content or split the implementation into coherent review slices. Do not truncate code blindly when doing so would remove the contracts, callers, or tests needed to judge the change correctly.

Use `task` and `diff` in most reviews. Add complete files only when the diff lacks necessary surrounding behavior. Use `repositoryContext` for concise facts the evaluator cannot infer, such as an established pattern or validation result.

Do not send the whole repository by default. Exclude unrelated files, generated output, vendored code, secrets, credentials, private keys, environment files, and noisy lockfile changes unless they are directly relevant to the review.

## Interpreting results

- Correctness and the user's requirements outrank every score.
- A low-confidence score is a prompt to inspect context, not a reason to rewrite code.
- Conditional metrics marked `applicable: false` require no action.
- Use `priorities` to find the most consequential weak dimensions, then inspect the actual code before changing it.
- When comparing evaluations, investigate meaningful regressions and weak metrics that remain unresolved. Do not chase tiny score changes.
- Continue to rely on tests, type checks, linters, security tools, and human judgment. Jev Review complements them; it does not replace them.

## Do not game scores

A higher score never justifies unnecessary abstraction, speculative architecture, scope expansion, breaking existing behavior, rewriting sound code, unconventional architecture without evidence, meaningless tests, unnecessary comments, or splitting cohesive code merely to shrink files.

Do not assume short functions, small files, single-purpose classes, zero duplication, more abstractions, more tests, or more comments are inherently better. Evaluate the consequences in this repository and for this task.
