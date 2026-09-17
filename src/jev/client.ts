import type { JevResponse } from "./schema.js";
import { gatewayRequest, parseGatewayResponse } from "./gateway.js";
import type { JevQuestions } from "../evaluation/questions.js";

export const JEV_API_ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";
export const JEV_MODEL = "anthropic/claude-sonnet-4.6";

type FetchImplementation = typeof fetch;
type SleepImplementation = (milliseconds: number) => Promise<void>;

export type JevClientOptions = {
  apiKey: string;
  model?: string;
  fetchImplementation?: FetchImplementation;
  sleep?: SleepImplementation;
  timeoutMilliseconds?: number;
  maxRetries?: number;
};

export class JevApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JevApiError";
    if (status !== undefined) this.status = status;
  }
}

export class JevClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: FetchImplementation;
  readonly #sleep: SleepImplementation;
  readonly #timeoutMilliseconds: number;
  readonly #maxRetries: number;

  constructor(options: JevClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new JevApiError("VERCEL_AI_GATEWAY is not set. Export it before starting your coding agent.");

    this.#apiKey = apiKey;
    this.#model = options.model?.trim() || JEV_MODEL;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 120_000;
    this.#maxRetries = options.maxRetries ?? 2;
  }

  async evaluate(state: unknown, questions: JevQuestions): Promise<JevResponse> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);

      try {
        const response = await this.#fetch(JEV_API_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(gatewayRequest(this.#model, state, questions)),
          signal: controller.signal
        });

        if (response.ok) {
          try {
            return parseGatewayResponse(await response.json(), questions);
          } catch (error) {
            if (controller.signal.aborted) throw error;
            throw new JevApiError("Vercel AI Gateway returned an incomplete or invalid structured review. Try again or choose an AI_GATEWAY_MODEL supporting structured outputs.");
          }
        }

        if (isRetryable(response.status) && attempt < this.#maxRetries) {
          await this.#sleep(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }

        throw await apiStatusError(response);
      } catch (error) {
        if (error instanceof JevApiError) throw error;
        if (isAbortError(error)) {
          throw new JevApiError(`Vercel AI Gateway did not respond within ${this.#timeoutMilliseconds}ms.`);
        }
        throw new JevApiError("Could not reach the Vercel AI Gateway. Check network access and try again.");
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new JevApiError("Vercel AI Gateway request failed after retries.");
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

async function apiStatusError(response: Response): Promise<JevApiError> {
  const status = response.status;
  const errorType = await readErrorType(response);

  if (status === 413 || (status === 400 && (errorType === "context_length_exceeded" || errorType === "max_tokens_exceeded"))) {
    return new JevApiError(
      "Vercel AI Gateway's input limit was exceeded. Send a smaller, focused code context or split the change across multiple review calls.",
      status
    );
  }
  if (status === 401 || status === 403) {
    return new JevApiError("Vercel AI Gateway rejected VERCEL_AI_GATEWAY. Check that the key is current and available to the MCP process.", status);
  }
  if (status === 402) {
    return new JevApiError("Vercel AI Gateway has insufficient credits. Check your Gateway billing.", status);
  }
  if (status === 422) {
    return new JevApiError("Vercel AI Gateway rejected the supplied evaluation context or questions.", status);
  }
  if (status === 429) {
    return new JevApiError("Vercel AI Gateway rate-limited the request after retries. Try again shortly.", status);
  }
  if (status === 529) {
    return new JevApiError("Vercel AI Gateway remained overloaded after retries. Try again shortly.", status);
  }
  return new JevApiError(`Vercel AI Gateway request failed with HTTP ${status}.`, status);
}

async function readErrorType(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.error)) return undefined;
    return typeof body.error.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);

    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.min(Math.max(retryDate - Date.now(), 0), 5_000);
  }
  return 250 * 2 ** attempt;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
