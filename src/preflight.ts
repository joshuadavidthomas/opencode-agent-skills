/**
 * Preflight LLM call for skill evaluation.
 *
 * Makes a quick LLM call to evaluate which skills are relevant to a user's message.
 * Supports both OAuth (via cached fetch) and API key authentication.
 */

import type { SkillSummary } from "./skills";


/** Timeout for preflight calls (short to avoid blocking) */
export const PREFLIGHT_TIMEOUT_MS = 2000;

/** Max tokens for preflight response (just need a JSON array) */
const MAX_TOKENS = 200;

/** Model priority for cheap/fast models */
const CHEAP_MODELS = {
  anthropic: "claude-3-haiku-20240307",
  "github-copilot": "gpt-4o-mini",
  "github-copilot-enterprise": "gpt-4o-mini",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
} as const;


/** Cached OAuth authentication state */
export interface OAuthAuthState {
  type: "oauth";
  fetch: typeof fetch;
  providerId: string;
  baseURL?: string;
}

/** Cached API key authentication state */
export interface ApiKeyAuthState {
  type: "apikey";
  apiKey: string;
  providerId: string;
  baseURL?: string;
}

/** Combined auth state */
export type AuthState = OAuthAuthState | ApiKeyAuthState;

/** Result of a preflight call */
interface PreflightResult {
  success: boolean;
  skills: string[];
  error?: string;
}


/**
 * Build the preflight evaluation prompt.
 */
export function buildPreflightPrompt(
  userMessage: string,
  skills: SkillSummary[]
): string {
  const skillsList = skills
    .map((s, i) => `${i + 1}. ${s.name}: ${s.description}`)
    .join("\n");

  return `You are evaluating which skills are relevant to a user's request.

User message:
"""
${userMessage.slice(0, 1000)}
"""

Available skills:
${skillsList}

Return a JSON array of skill names that are relevant to this request.
If no skills are relevant, return an empty array.
Only include skills that would genuinely help with this specific task.

Response (JSON array only):`;
}


/**
 * Call Anthropic API with OAuth fetch.
 */
async function callAnthropicOAuth(
  authFetch: typeof fetch,
  prompt: string
): Promise<string> {
  const response = await authFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CHEAP_MODELS.anthropic,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const json = (await response.json()) as { content: Array<{ text: string }> };
  return json.content[0]?.text ?? "";
}

/**
 * Call OpenAI-compatible API with OAuth fetch (GitHub Copilot, etc).
 */
async function callOpenAICompatibleOAuth(
  authFetch: typeof fetch,
  baseURL: string,
  prompt: string,
  model: string
): Promise<string> {
  const response = await authFetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible API error: ${response.status}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "";
}

/**
 * Call Anthropic API with API key.
 */
async function callAnthropicWithKey(
  apiKey: string,
  prompt: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: CHEAP_MODELS.anthropic,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const json = (await response.json()) as { content: Array<{ text: string }> };
  return json.content[0]?.text ?? "";
}

/**
 * Call OpenAI API with API key.
 */
async function callOpenAIWithKey(
  apiKey: string,
  prompt: string,
  baseURL: string = "https://api.openai.com/v1"
): Promise<string> {
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CHEAP_MODELS.openai,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "";
}


/**
 * Parse skill names from LLM response.
 * Attempts to extract a JSON array, with fallback regex parsing.
 */
export function parseSkillResponse(response: string): string[] {
  const trimmed = response.trim();

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Not valid JSON, try extracting
  }

  // Try to find JSON array in response
  const arrayMatch = trimmed.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      // Couldn't parse extracted array
    }
  }

  // Fallback: return empty array
  return [];
}


/**
 * Make a preflight LLM call to evaluate which skills are relevant.
 *
 * @param auth - Authentication state (OAuth or API key)
 * @param userMessage - The user's message to evaluate
 * @param skills - Available skill summaries
 * @returns Array of relevant skill names, empty on failure
 */
export async function makePreflightCall(
  auth: AuthState,
  userMessage: string,
  skills: SkillSummary[]
): Promise<PreflightResult> {
  if (skills.length === 0) {
    return { success: true, skills: [] };
  }

  const prompt = buildPreflightPrompt(userMessage, skills);

  try {
    let response: string;

    if (auth.type === "oauth") {
      const { fetch: authFetch, providerId, baseURL } = auth;

      if (providerId === "anthropic") {
        response = await callAnthropicOAuth(authFetch, prompt);
      } else if (
        providerId === "github-copilot" ||
        providerId === "github-copilot-enterprise"
      ) {
        if (!baseURL) {
          return { success: false, skills: [], error: "No baseURL for GitHub Copilot" };
        }
        const model = CHEAP_MODELS[providerId as keyof typeof CHEAP_MODELS] ?? "gpt-4o-mini";
        response = await callOpenAICompatibleOAuth(authFetch, baseURL, prompt, model);
      } else if (providerId === "openai") {
        const url = baseURL ?? "https://api.openai.com/v1";
        response = await callOpenAICompatibleOAuth(authFetch, url, prompt, CHEAP_MODELS.openai);
      } else {
        return { success: false, skills: [], error: `Unsupported OAuth provider: ${providerId}` };
      }
    } else {
      // API key auth
      const { apiKey, providerId, baseURL } = auth;

      if (providerId === "anthropic" || providerId === "opencode") {
        // opencode uses Anthropic-compatible API
        response = await callAnthropicWithKey(apiKey, prompt);
      } else if (providerId === "openai") {
        response = await callOpenAIWithKey(apiKey, prompt, baseURL);
      } else {
        return { success: false, skills: [], error: `Unsupported API key provider: ${providerId}` };
      }
    }

    const matchedSkills = parseSkillResponse(response);
    return { success: true, skills: matchedSkills };
  } catch (error) {
    return {
      success: false,
      skills: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Make a preflight call with timeout.
 * Returns empty array on timeout or error.
 */
export async function makePreflightCallWithTimeout(
  auth: AuthState,
  userMessage: string,
  skills: SkillSummary[],
  timeoutMs: number = PREFLIGHT_TIMEOUT_MS
): Promise<string[]> {
  try {
    const result = await Promise.race([
      makePreflightCall(auth, userMessage, skills),
      new Promise<PreflightResult>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);

    return result.skills;
  } catch {
    // On timeout or error, return empty (no skills matched)
    return [];
  }
}
