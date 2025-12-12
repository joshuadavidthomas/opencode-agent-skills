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
  injectSyntheticContent,
  initDebugLog,
  type SessionContext,
} from "./utils";
import { injectSkillsList, getSkillSummaries } from "./skills";
import { GetAvailableSkills, ReadSkillFile, RunSkillScript, UseSkill } from "./tools";
import { matchSkills, precomputeSkillEmbeddings } from "./preflight";

const setupCompleteSessions = new Set<string>();

function formatMatchedSkillsInjection(
  matchedSkills: Array<{ name: string; description: string }>
): string {
  const skillLines = matchedSkills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `<skill-evaluation-required>
SKILL EVALUATION PROCESS

The following skills may be relevant to your request:

${skillLines}

Step 1 - EVALUATE: Determine if these skills would genuinely help
Step 2 - DECIDE: Choose which skills (if any) are actually needed
Step 3 - ACTIVATE: Call use_skill("name") for each chosen skill

If no skills are needed for this request, proceed without activation.
</skill-evaluation-required>`;
}

export const SkillsPlugin: Plugin = async ({ client, $, directory }) => {
  // Initialize debug logging to .debug/ directory
  await initDebugLog(directory);

  // Pre-compute skill embeddings in background (non-blocking)
  // Model loading and embedding generation happens asynchronously
  const skills = await getSkillSummaries(directory);
  precomputeSkillEmbeddings(skills).catch(err => {
    // Don't block plugin startup on embedding failures
    console.error("Failed to pre-compute skill embeddings:", err);
  });

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

        // First message - no skill matching yet
        return;
      }

      // Second+ messages: Try client-side skill matching
      const userText = extractTextFromParts(output.parts);
      if (!userText) {
        return;
      }

      const skills = await getSkillSummaries(directory);
      if (skills.length === 0) {
        return;
      }

      const matchResult = await matchSkills(userText, skills);

      if (!matchResult.matched || matchResult.skills.length === 0) {
        return;
      }

      const matchedSkills = skills.filter((s) =>
        matchResult.skills.includes(s.name)
      );

      if (matchedSkills.length > 0) {
        const injectionText = formatMatchedSkillsInjection(matchedSkills);

        const context: SessionContext = {
          model: output.message.model,
          agent: output.message.agent,
        };

        await injectSyntheticContent(client, sessionID, injectionText, context);
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
