/**
 * Claude Code compatibility utilities
 *
 * Functions and types for discovering skills from Claude's plugin system
 * (marketplaces and plugin cache directories).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { findFile } from "./utils";
import type { LabeledDiscoveryResult } from "./skills";

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

/** Structure of Claude's marketplace.json file */
interface MarketplaceManifest {
  plugins: Array<{
    name: string;
    skills?: string[];
  }>;
}

/** Structure of Claude's installed_plugins.json file */
interface InstalledPlugins {
  plugins: {
    [key: string]: {
      installPath: string;
    };
  };
}

/**
 * Discover skills from Claude plugin marketplaces.
 * Only loads skills from INSTALLED plugins (checked via installed_plugins.json).
 */
export async function discoverMarketplaceSkills(): Promise<LabeledDiscoveryResult[]> {
  const results: LabeledDiscoveryResult[] = [];
  const claudeDir = path.join(homedir(), '.claude', 'plugins');
  const installedPath = path.join(claudeDir, 'installed_plugins.json');
  const marketplacesDir = path.join(claudeDir, 'marketplaces');

  let installed: InstalledPlugins;
  try {
    const content = await fs.readFile(installedPath, 'utf-8');
    installed = JSON.parse(content);
  } catch {
    return results;
  }

  for (const pluginKey of Object.keys(installed.plugins || {})) {
    const [pluginName, marketplaceName] = pluginKey.split('@');
    if (!pluginName || !marketplaceName) continue;

    const manifestPath = path.join(marketplacesDir, marketplaceName, '.claude-plugin', 'marketplace.json');
    let manifest: MarketplaceManifest;
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch {
      continue;
    }

    const plugin = manifest.plugins?.find(p => p.name === pluginName);
    if (!plugin?.skills) continue;

    for (const skillRelPath of plugin.skills) {
      const cleanPath = skillRelPath.replace(/^\.\//, '');
      const directory = path.join(marketplacesDir, marketplaceName, cleanPath);
      const skillName = path.basename(cleanPath);

      const found = await findFile(directory, skillName, 'SKILL.md');
      if (found) {
        results.push({ ...found, label: 'claude-plugins' });
      }
    }
  }

  return results;
}

/**
 * Discover skills from Claude Code's plugin cache directory.
 * Plugins are cached at ~/.claude/plugins/cache/<plugin-name>/skills/<skill-name>/SKILL.md
 */
export async function discoverPluginCacheSkills(): Promise<LabeledDiscoveryResult[]> {
  const results: LabeledDiscoveryResult[] = [];
  const cacheDir = path.join(homedir(), '.claude', 'plugins', 'cache');

  try {
    await fs.access(cacheDir);
  } catch {
    return [];
  }

  const plugins = await fs.readdir(cacheDir, { withFileTypes: true });

  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;

    const skillsDir = path.join(cacheDir, plugin.name, 'skills');

    try {
      const skillDirs = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const skillDir of skillDirs) {
        if (!skillDir.isDirectory()) continue;

        const directory = path.join(skillsDir, skillDir.name);
        const found = await findFile(directory, skillDir.name, 'SKILL.md');
        if (found) {
          results.push({ ...found, label: 'claude-plugins' });
        }
      }
    } catch { }
  }

  return results;
}
