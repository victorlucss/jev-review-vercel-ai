import { JevApiError } from "../jev/client.js";

export function getJevApiKey(environment: NodeJS.ProcessEnv = process.env): string {
  const apiKey = environment.VERCEL_AI_GATEWAY?.trim();
  if (!apiKey) {
    throw new JevApiError("VERCEL_AI_GATEWAY is not set. Export it before starting your coding agent.");
  }
  return apiKey;
}
