/**
 * OpenCode Agent Skills Plugin
 *
 * A dynamic skills system that provides 4 tools:
 * - use_skill: Load a skill's SKILL.md into context
 * - read_skill_file: Read supporting files from a skill directory
 * - run_skill_script: Execute scripts from a skill directory
 * - get_available_skills: Get available skills
 *
 * Skills are discovered from multiple locations (project > user > marketplace)
 * and validated against the Anthropic Agent Skills Spec.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { maybeInjectSuperpowersBootstrap } from "./superpowers";
import {
  getSessionContext,
  extractTextFromParts,
  type SessionContext,
} from "./utils";
import { injectSkillsList, getSkillSummaries } from "./skills";
import { GetAvailableSkills, ReadSkillFile, RunSkillScript, UseSkill } from "./tools";
import {
  makePreflightCallWithTimeout,
  type OAuthAuthState,
  type ApiKeyAuthState,
} from "./preflight";

interface RuntimeProviderContext {
  info?: { id?: string };
  options?: {
    fetch?: typeof fetch;
    baseURL?: string;
    apiKey?: string;
  };
}

const setupCompleteSessions = new Set<string>();
const sessionAuthCache = new Map<string, OAuthAuthState>();
let apiKeyAuth: ApiKeyAuthState | null = null;

function formatMatchedSkillsInjection(
  matchedSkills: Array<{ name: string; description: string }>
): string {
  const skillLines = matchedSkills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `<relevant-skills>
The following skills may help with your request. Use the use_skill tool to load any that seem relevant.

${skillLines}
</relevant-skills>`;
}

export const SkillsPlugin: Plugin = async ({ client, $, directory }) => {
  try {
    const providers = await client.provider.list();
    const connected = providers.data?.connected ?? [];
    const allProviders = (providers.data?.all ?? []) as Array<{
      id: string;
      key?: string;
      options?: { apiKey?: string; baseURL?: string };
    }>;

    for (const provider of allProviders) {
      if (!connected.includes(provider.id)) continue;

      const apiKey = provider.key ?? provider.options?.apiKey;
      if (apiKey && apiKey.length > 0) {
        apiKeyAuth = {
          type: "apikey",
          apiKey,
          providerId: provider.id,
          baseURL: provider.options?.baseURL,
        };
        break;
      }
    }
  } catch {
    // Silently ignore - will fall back to OAuth only
  }

  return {
    "chat.message": async (input, output) => {
      const sessionID = output.message.sessionID;
      const isFirstMessage = !setupCompleteSessions.has(sessionID);

      if (isFirstMessage) {
        // Check if skills content was already injected (handles plugin reload/reconnection)
        try {
          const existing = await client.session.messages({
            path: { id: sessionID },
          });

          if (existing.data) {
            const hasSkillsContent = existing.data.some(msg => {
              const parts = (msg as any).parts || (msg.info as any).parts;
              if (!parts) return false;
              return parts.some((part: any) =>
                part.type === 'text' && part.text?.includes('<available-skills>')
              );
            });

            if (hasSkillsContent) {
              setupCompleteSessions.add(sessionID);
            }
          }
        } catch {
          // On error, treat as first message
        }
      }

      if (!setupCompleteSessions.has(sessionID)) {
        setupCompleteSessions.add(sessionID);

        const context: SessionContext = {
          model: output.message.model,
          agent: output.message.agent,
        };

        await maybeInjectSuperpowersBootstrap(directory, client, sessionID, context);
        await injectSkillsList(directory, client, sessionID, context);

        // First message - no preflight (no cached auth yet)
        return;
      }

      // Second+ messages: Try preflight skill evaluation
      const auth = sessionAuthCache.get(sessionID) ?? apiKeyAuth;
      if (!auth) {
        return;
      }

      const userText = extractTextFromParts(output.parts);
      if (!userText) {
        return;
      }

      const skills = await getSkillSummaries(directory);
      if (skills.length === 0) {
        return;
      }

      const matchedSkillNames = await makePreflightCallWithTimeout(
        auth,
        userText,
        skills
      );

      if (matchedSkillNames.length === 0) {
        return;
      }

      const matchedSkills = skills.filter((s) =>
        matchedSkillNames.includes(s.name)
      );

      if (matchedSkills.length > 0) {
        const injectionText = formatMatchedSkillsInjection(matchedSkills);

        output.parts.push({
          type: "text",
          text: injectionText,
          synthetic: true,
        } as typeof output.parts[number]);
      }
    },

    "chat.params": async (input) => {
      const sessionID = input.sessionID;

      // Cast to runtime type (SDK types don't include options.fetch)
      const provider = input.provider as unknown as RuntimeProviderContext;

      if (
        provider?.options &&
        typeof provider.options.fetch === "function"
      ) {
        sessionAuthCache.set(sessionID, {
          type: "oauth",
          fetch: provider.options.fetch,
          providerId: provider.info?.id ?? input.model?.id ?? "unknown",
          baseURL: provider.options.baseURL,
        });
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        await maybeInjectSuperpowersBootstrap(directory, client, sessionID, context);
        await injectSkillsList(directory, client, sessionID, context);
      }

      if (event.type === "session.deleted") {
        const sessionID = event.properties.info.id;
        setupCompleteSessions.delete(sessionID);
        sessionAuthCache.delete(sessionID);
      }
    },

    tool: {
      get_available_skills: GetAvailableSkills(directory),
      read_skill_file: ReadSkillFile(directory, client),
      run_skill_script: RunSkillScript(directory, $),
      use_skill: UseSkill(directory, client),
    },
  };
};
