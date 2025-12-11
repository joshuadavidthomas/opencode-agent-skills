/**
 * Claude Code compatibility utilities
 *
 * Functions and types for discovering skills from Claude's plugin system
 * (marketplaces and plugin cache directories).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

// ============================================================================
// Types
// ============================================================================

/**
 * Skill label indicating the source/location of a skill.
 * - project: .opencode/skills/ in project directory
 * - user: ~/.config/opencode/skills/
 * - claude-project: .claude/skills/ in project directory
 * - claude-user: ~/.claude/skills/
 * - claude-plugins: ~/.claude/plugins/ (cache or marketplace)
 */
export type SkillLabel = "project" | "user" | "claude-project" | "claude-user" | "claude-plugins";

/**
 * Structure of Claude's marketplace.json file.
 * Defines which skills are available in a marketplace.
 */
export interface MarketplaceManifest {
  plugins: Array<{
    name: string;
    skills?: string[];
  }>;
}

/**
 * Structure of Claude's installed_plugins.json file.
 * Maps plugin keys (e.g., "document-skills@anthropic-agent-skills") to install paths.
 */
export interface InstalledPlugins {
  plugins: {
    [key: string]: {
      installPath: string;
    };
  };
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Tool translation guide for skills written for Claude Code.
 * Injected into skill content to help the AI use OpenCode equivalents.
 */
export const toolTranslation = `<tool-translation>
This skill may reference Claude Code tools. Use OpenCode equivalents:
- TodoWrite/TodoRead -> todowrite/todoread
- Task (subagents) -> task tool with subagent_type parameter
- Skill tool -> use_skill tool
- Read/Write/Edit/Bash/Glob/Grep/WebFetch -> lowercase (read/write/edit/bash/glob/grep/webfetch)
</tool-translation>`;

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Discover skills from Claude plugin marketplaces.
 * Only loads skills from INSTALLED plugins (checked via installed_plugins.json).
 */
export async function discoverMarketplaceSkills(
  label: SkillLabel
): Promise<Array<{ skillPath: string; relativePath: string; label: SkillLabel }>> {
  const results: Array<{ skillPath: string; relativePath: string; label: SkillLabel }> = [];
  const claudeDir = path.join(homedir(), '.claude', 'plugins');
  const installedPath = path.join(claudeDir, 'installed_plugins.json');
  const marketplacesDir = path.join(claudeDir, 'marketplaces');

  // Read installed plugins
  let installed: InstalledPlugins;
  try {
    const content = await fs.readFile(installedPath, 'utf-8');
    installed = JSON.parse(content);
  } catch {
    // No installed plugins file
    return results;
  }

  // Process each installed plugin (e.g., "document-skills@anthropic-agent-skills")
  for (const pluginKey of Object.keys(installed.plugins || {})) {
    const [pluginName, marketplaceName] = pluginKey.split('@');
    if (!pluginName || !marketplaceName) continue;

    // Read the marketplace manifest
    const manifestPath = path.join(marketplacesDir, marketplaceName, '.claude-plugin', 'marketplace.json');
    let manifest: MarketplaceManifest;
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch {
      continue; // Can't read manifest
    }

    // Find the specific plugin in the manifest
    const plugin = manifest.plugins?.find(p => p.name === pluginName);
    if (!plugin?.skills) continue;

    // Load only skills from this installed plugin
    for (const skillRelPath of plugin.skills) {
      const cleanPath = skillRelPath.replace(/^\.\//, '');
      const skillMdPath = path.join(marketplacesDir, marketplaceName, cleanPath, 'SKILL.md');

      try {
        await fs.stat(skillMdPath);
        const skillName = path.basename(cleanPath);
        results.push({
          skillPath: skillMdPath,
          relativePath: skillName,
          label
        });
      } catch {
        // SKILL.md doesn't exist
      }
    }
  }

  return results;
}

/**
 * Discover skills from Claude Code's plugin cache directory.
 * Plugins are cached at ~/.claude/plugins/cache/<plugin-name>/skills/<skill-name>/SKILL.md
 */
export async function discoverPluginCacheSkills(label: SkillLabel): Promise<Array<{ skillPath: string; relativePath: string; label: SkillLabel }>> {
  const results: Array<{ skillPath: string; relativePath: string; label: SkillLabel }> = [];
  const cacheDir = path.join(homedir(), '.claude', 'plugins', 'cache');

  try {
    const plugins = await fs.readdir(cacheDir, { withFileTypes: true });

    for (const plugin of plugins) {
      let pluginStats;
      try {
        pluginStats = await fs.stat(path.join(cacheDir, plugin.name));
      } catch {
        continue;
      }
      if (!pluginStats.isDirectory()) continue;

      const skillsDir = path.join(cacheDir, plugin.name, 'skills');

      try {
        const skillDirs = await fs.readdir(skillsDir, { withFileTypes: true });

        for (const skillDir of skillDirs) {
          let skillDirStats;
          try {
            skillDirStats = await fs.stat(path.join(skillsDir, skillDir.name));
          } catch {
            continue;
          }
          if (!skillDirStats.isDirectory()) continue;

          const skillMdPath = path.join(skillsDir, skillDir.name, 'SKILL.md');

          try {
            await fs.stat(skillMdPath);
            results.push({
              skillPath: skillMdPath,
              relativePath: skillDir.name,
              label
            });
          } catch {
            // SKILL.md doesn't exist
          }
        }
      } catch {
        // No skills directory in this plugin
      }
    }
  } catch {
    // Cache directory doesn't exist
  }

  return results;
}
