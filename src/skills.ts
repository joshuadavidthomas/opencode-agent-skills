/**
 * Core skill discovery and management logic.
 *
 * Handles skill discovery from multiple locations (project > user > marketplace),
 * validation against the Anthropic Agent Skills Spec, and skill resolution.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { parseYamlFrontmatter } from "./utils";
import { discoverMarketplaceSkills, discoverPluginCacheSkills, type SkillLabel } from "./claude";

// ============================================================================
// Types
// ============================================================================

/**
 * Script metadata with both relative and absolute paths.
 */
export interface Script {
  relativePath: string;
  absolutePath: string;
}

/**
 * Complete metadata for a discovered skill.
 */
export interface Skill {
  name: string;
  description: string;
  path: string;
  relativePath: string;
  namespace?: string;
  label: SkillLabel;
  scripts: Script[];
  template: string;
}

/**
 * Configuration for a skill discovery path.
 */
export interface DiscoveryPath {
  path: string;
  label: SkillLabel;
  maxDepth: number;
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * Anthropic Agent Skills Spec v1.0 compliant schema.
 * @see https://github.com/anthropics/skills/blob/main/agent_skills_spec.md
 */
const SkillFrontmatterSchema = z.object({
  // Required fields
  name: z.string()
    .regex(/^[\p{Ll}\p{N}-]+$/u, { message: "Name must be lowercase alphanumeric with hyphens" })
    .min(1, { message: "Name cannot be empty" }),
  description: z.string()
    .min(1, { message: "Description cannot be empty" }),

  // Optional fields (per spec)
  license: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional()
});

type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively list all files in a directory, returning relative paths.
 * Excludes SKILL.md since it's already loaded as the main content.
 */
export async function listSkillFiles(skillPath: string, maxDepth: number = 3): Promise<string[]> {
  const files: string[] = [];

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        try {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            await recurse(fullPath, depth + 1, newRelPath);
          } else if (stats.isFile() && entry.name !== 'SKILL.md') {
            files.push(newRelPath);
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await recurse(skillPath, 0, '');
  return files.sort();
}

/**
 * Recursively find executable scripts in a skill's directory.
 * Skips hidden directories (starting with .) and common dependency dirs.
 * Only files with executable bit set are returned.
 */
export async function findScripts(skillPath: string, maxDepth: number = 10): Promise<Script[]> {
  const scripts: Script[] = [];
  const skipDirs = new Set(['node_modules', '__pycache__', '.git', '.venv', 'venv', '.tox', '.nox']);

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (skipDirs.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await recurse(fullPath, depth + 1, newRelPath);
        } else if (stats.isFile()) {
          // Check executable bit (owner, group, or other)
          if (stats.mode & 0o111) {
            scripts.push({
              relativePath: newRelPath,
              absolutePath: fullPath
            });
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await recurse(skillPath, 0, '');
  return scripts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Parse a SKILL.md file and validate its frontmatter.
 * Returns null if parsing fails (with error logging).
 */
export async function parseSkillFile(
  skillPath: string,
  relativePath: string,
  label: SkillLabel
): Promise<Skill | null> {
  const content = await fs.readFile(skillPath, 'utf-8').catch(() => null);
  if (!content) {
    return null;
  }

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch?.[1] || !frontmatterMatch[2]) {
    console.error(`   Skill at ${skillPath} has no valid frontmatter`);
    return null;
  }

  const frontmatterText = frontmatterMatch[1];
  const skillContent = frontmatterMatch[2].trim();

  // Parse YAML frontmatter
  let frontmatterObj: unknown;
  try {
    frontmatterObj = parseYamlFrontmatter(frontmatterText);
  } catch {
    console.error(`   Invalid YAML in ${skillPath}`);
    return null;
  }

  // Validate with Zod schema
  let frontmatter: SkillFrontmatter;
  try {
    frontmatter = SkillFrontmatterSchema.parse(frontmatterObj);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`   Invalid frontmatter in ${skillPath}:`);
      error.issues.forEach((err) => {
        console.error(`     - ${err.path.join(".")}: ${err.message}`);
      });
    }
    return null;
  }

  // Validate name matches directory
  const skillDir = path.basename(path.dirname(skillPath));
  if (frontmatter.name !== skillDir) {
    console.error(
      `   Name mismatch in ${skillPath}:`,
      `\n     Frontmatter: "${frontmatter.name}"`,
      `\n     Directory: "${skillDir}"`,
      `\n     Fix: Rename directory or update frontmatter name field`
    );
    return null;
  }

  // Find scripts
  const skillDirPath = path.dirname(skillPath);
  const scripts = await findScripts(skillDirPath);

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: skillDirPath,
    relativePath,
    namespace: frontmatter.metadata?.namespace,
    label,
    scripts,
    template: skillContent
  };
}

/**
 * Recursively find SKILL.md files in a directory.
 */
export async function findSkillsRecursive(
  baseDir: string,
  label: SkillLabel,
  maxDepth: number = 3
): Promise<Array<{ skillPath: string; relativePath: string; label: SkillLabel }>> {
  const results: Array<{ skillPath: string; relativePath: string; label: SkillLabel }> = [];

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (!stats.isDirectory()) continue;

        const skillFile = path.join(fullPath, 'SKILL.md');
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        try {
          await fs.stat(skillFile);
          results.push({
            skillPath: skillFile,
            relativePath: newRelPath,
            label
          });
        } catch {
          // No SKILL.md, recurse into subdirectories
          await recurse(fullPath, depth + 1, newRelPath);
        }
      }
    } catch {
      // Directory doesn't exist or not accessible
    }
  }

  try {
    await fs.access(baseDir);
    await recurse(baseDir, 0, '');
  } catch {
    // Base directory doesn't exist
  }

  return results;
}

/**
 * Discover all skills from all locations.
 *
 * Discovery order (first found wins, OpenCode trumps Claude at each level):
 * 1. .opencode/skills/                 (project - OpenCode)
 * 2. .claude/skills/                   (project - Claude)
 * 3. ~/.config/opencode/skills/        (user - OpenCode)
 * 4. ~/.claude/skills/                 (user - Claude)
 * 5. ~/.claude/plugins/cache/          (cached plugin skills)
 * 6. ~/.claude/plugins/marketplaces/   (installed plugins)
 *
 * No shadowing - unique names only. First match wins, duplicates are warned.
 */
export async function discoverAllSkills(directory: string): Promise<Map<string, Skill>> {
  const discoveryPaths: DiscoveryPath[] = [
    {
      path: path.join(directory, '.opencode', 'skills'),
      label: 'project',
      maxDepth: 3
    },
    {
      path: path.join(directory, '.claude', 'skills'),
      label: 'claude-project',
      maxDepth: 1
    },
    {
      path: path.join(homedir(), '.config', 'opencode', 'skills'),
      label: 'user',
      maxDepth: 3
    },
    {
      path: path.join(homedir(), '.claude', 'skills'),
      label: 'claude-user',
      maxDepth: 1
    }
  ];

  const skillsByName = new Map<string, Skill>();

  // Process standard discovery paths
  for (const { path: baseDir, label, maxDepth } of discoveryPaths) {
    const found = await findSkillsRecursive(baseDir, label, maxDepth);

    for (const { skillPath, relativePath, label: skillLabel } of found) {
      const skill = await parseSkillFile(skillPath, relativePath, skillLabel);
      if (!skill) continue;

      const existing = skillsByName.get(skill.name);
      if (existing) {
        // Silently skip duplicates - first found wins
        continue;
      }

      skillsByName.set(skill.name, skill);
    }
  }

  // Process plugin cache skills
  const cacheSkills = await discoverPluginCacheSkills('claude-plugins');

  for (const { skillPath, relativePath, label } of cacheSkills) {
    const skill = await parseSkillFile(skillPath, relativePath, label);
    if (!skill) continue;

    const existing = skillsByName.get(skill.name);
    if (existing) {
      // Silently skip duplicates - first found wins
      continue;
    }

    skillsByName.set(skill.name, skill);
  }

  // Process marketplace skills
  const marketplaceSkills = await discoverMarketplaceSkills('claude-plugins');

  for (const { skillPath, relativePath, label } of marketplaceSkills) {
    const skill = await parseSkillFile(skillPath, relativePath, label);
    if (!skill) continue;

    const existing = skillsByName.get(skill.name);
    if (existing) {
      // Silently skip duplicates - first found wins
      continue;
    }

    skillsByName.set(skill.name, skill);
  }

  return skillsByName;
}

/**
 * Resolve a skill by name, handling namespace prefixes.
 * Supports: "skill-name", "project:skill-name", "user:skill-name", etc.
 */
export function resolveSkill(
  skillName: string,
  skillsByName: Map<string, Skill>
): Skill | null {
  // Check for namespace prefix
  if (skillName.includes(':')) {
    const [namespace, name] = skillName.split(':');

    // Look for skill with matching name AND label/namespace
    for (const skill of skillsByName.values()) {
      if (skill.name === name && (skill.label === namespace || skill.namespace === namespace)) {
        return skill;
      }
    }
    return null;
  }

  // Direct lookup by name
  return skillsByName.get(skillName) || null;
}
