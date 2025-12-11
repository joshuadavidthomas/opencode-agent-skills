/**
 * OpenCode Agent Skills Plugin
 *
 * A dynamic skills system that provides 4 tools:
 * - use_skill: Load a skill's SKILL.md into context
 * - read_skill_file: Read supporting files from a skill directory
 * - run_skill_script: Execute scripts from a skill directory
 * - find_skills: Search and list available skills
 *
 * Skills are discovered from multiple locations (project > user > marketplace)
 * and validated against the Anthropic Agent Skills Spec.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { maybeInjectSuperpowersBootstrap } from "./superpowers";
import { getSessionContext, type SessionContext } from "./utils";
import { injectSkillsList } from "./skills";
import { FindSkills, ReadSkillFile, RunSkillScript, UseSkill } from "./tools";

export const SkillsPlugin: Plugin = async ({ client, $, directory }) => {
  const injectedSessions = new Set<string>();

  return {
    "chat.message": async (input, output) => {
      const sessionID = output.message.sessionID;

      // Skip if already injected this session (in-memory fast path)
      if (injectedSessions.has(sessionID)) return;

      // Check if session already has messages (handles plugin reload/reconnection)
      try {
        const existing = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 1 }
        });

        if (existing.data && existing.data.length > 0) {
          injectedSessions.add(sessionID);
          return;
        }
      } catch {
        // On error, proceed with injection
      }

      injectedSessions.add(sessionID);

      // Use output.message which has the resolved model/agent values.
      // This ensures our injected noReply message has identical model/agent
      // to the real user message, preventing mode/model switching.
      const context: SessionContext = {
        model: output.message.model,
        agent: output.message.agent
      };

      await maybeInjectSuperpowersBootstrap(directory, client, sessionID, context);
      await injectSkillsList(directory, client, sessionID, context);
    },

    event: async ({ event }) => {
      if (event.type === 'session.compacted') {
        const sessionID = event.properties.sessionID;
        const context = await getSessionContext(client, sessionID);
        await maybeInjectSuperpowersBootstrap(directory, client, sessionID, context);
        await injectSkillsList(directory, client, sessionID, context);
      }
    },

    tool: {
      find_skills: FindSkills(directory),
      read_skill_file: ReadSkillFile(directory, client),
      run_skill_script: RunSkillScript(directory, $),
      use_skill: UseSkill(directory, client),
    }
  };
};
