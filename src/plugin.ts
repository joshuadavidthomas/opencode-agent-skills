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

import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

/**
 * Parse simple YAML frontmatter.
 * Handles the subset used by Anthropic Agent Skills Spec:
 * - Simple key: value strings
 * - Arrays (lines starting with "  - ")
 * - Nested objects (indented key: value under a parent key)
 */
function parseYamlFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let currentObject: Record<string, string> | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') continue;

    // Check for array item (starts with "  - ")
    if (line.match(/^\s{2}-\s+/) && currentKey !== null) {
      const value = line.replace(/^\s{2}-\s+/, '').trim();
      if (currentArray === null) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      currentArray.push(value);
      continue;
    }

    // Check for nested object value (starts with "  " but not "  - ")
    if (line.match(/^\s{2}\w/) && currentKey !== null) {
      const nestedMatch = line.match(/^\s{2}(\w[\w-]*)\s*:\s*(.*)$/);
      if (nestedMatch && nestedMatch[1] && nestedMatch[2] !== undefined) {
        if (currentObject === null) {
          currentObject = {};
          result[currentKey] = currentObject;
        }
        currentObject[nestedMatch[1]] = nestedMatch[2].trim();
        continue;
      }
    }

    // Top-level key: value
    const topMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (topMatch && topMatch[1] && topMatch[2] !== undefined) {
      // Save any pending array/object
      currentArray = null;
      currentObject = null;

      const key = topMatch[1];
      const value = topMatch[2].trim();
      currentKey = key;

      // If value is empty, it's the start of an array or object
      if (value === '') {
        continue;
      }

      // Remove surrounding quotes if present
      const unquoted = value.replace(/^["'](.*)["']$/, '$1');
      result[key] = unquoted;
    }
  }

  return result;
}

interface Script {
  name: string;
  path: string;
}

type SkillLabel = "project" | "user" | "claude-project" | "claude-user" | "claude-plugins";

interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  relativePath: string;
  namespace?: string;
  label: SkillLabel;
  scripts: Script[];
  content: string;
}

interface DiscoveryPath {
  path: string;
  label: SkillLabel;
  maxDepth: number;
}

interface MarketplaceManifest {
  plugins: Array<{
    name: string;
    skills?: string[];
  }>;
}

interface InstalledPlugins {
  plugins: {
    [key: string]: {
      installPath: string;
    };
  };
}

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

/**
 * Inject content into session via noReply + synthetic.
 * Content persists across context compaction.
 *
 * IMPORTANT: Pass a model to avoid opencode issue #4475 where noReply
 * prompts without an explicit model cause model switching to agent default.
 */
type OpencodeClient = PluginInput["client"];

async function injectSyntheticContent(
  client: OpencodeClient,
  sessionID: string,
  text: string,
  model?: { providerID: string; modelID: string }
): Promise<void> {
  await client.session.prompt({
    path: { id: sessionID },
    body: {
      noReply: true,
      model,
      parts: [{ type: "text", text, synthetic: true }],
    },
  });
}

/**
 * Inject the available skills list into a session.
 * Used on session start and after compaction.
 */
async function injectSkillsList(
  client: OpencodeClient,
  sessionID: string,
  skills: SkillMetadata[],
  model?: { providerID: string; modelID: string }
): Promise<void> {
  if (skills.length === 0) return;

  const skillsList = skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n');

  await injectSyntheticContent(
    client,
    sessionID,
    `<available-skills>
Use the use_skill, read_skill_file, run_skill_script, and find_skills tools to work with skills.

${skillsList}
</available-skills>`,
    model
  );
}

/**
 * Recursively list all files in a directory, returning relative paths.
 * Excludes SKILL.md since it's already loaded as the main content.
 */
async function listSkillFiles(skillPath: string, maxDepth: number = 3): Promise<string[]> {
  const files: string[] = [];

  async function recurse(dir: string, depth: number, relPath: string) {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const newRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await recurse(fullPath, depth + 1, newRelPath);
        } else if (entry.isFile() && entry.name !== 'SKILL.md') {
          files.push(newRelPath);
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
 * Find executable scripts in a skill's directory and scripts/ subdirectory.
 * Only files with executable bit set are returned.
 */
async function findScripts(skillPath: string): Promise<Script[]> {
  const scripts: Script[] = [];
  const dirsToCheck = [skillPath, path.join(skillPath, 'scripts')];

  for (const dir of dirsToCheck) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fullPath = path.join(dir, entry.name);
        const stats = await fs.stat(fullPath);

        // Check executable bit (owner, group, or other)
        if (stats.mode & 0o111) {
          const nameWithoutExt = path.parse(entry.name).name;
          scripts.push({
            name: nameWithoutExt,
            path: fullPath
          });
        }
      }
    } catch {
      // Directory doesn't exist or not accessible - that's fine
    }
  }

  return scripts;
}

/**
 * Parse a SKILL.md file and validate its frontmatter.
 * Returns null if parsing fails (with error logging).
 */
async function parseSkillFile(
  skillPath: string,
  relativePath: string,
  label: SkillLabel
): Promise<SkillMetadata | null> {
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
    content: skillContent
  };
}

/**
 * Recursively find SKILL.md files in a directory.
 */
async function findSkillsRecursive(
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
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(dir, entry.name);
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
 * Discover skills from Claude plugin marketplaces.
 * Only loads skills from INSTALLED plugins (checked via installed_plugins.json).
 */
async function discoverMarketplaceSkills(
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
async function discoverPluginCacheSkills(label: SkillLabel): Promise<Array<{ skillPath: string; relativePath: string; label: SkillLabel }>> {
  const results: Array<{ skillPath: string; relativePath: string; label: SkillLabel }> = [];
  const cacheDir = path.join(homedir(), '.claude', 'plugins', 'cache');

  try {
    const plugins = await fs.readdir(cacheDir, { withFileTypes: true });

    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;

      const skillsDir = path.join(cacheDir, plugin.name, 'skills');

      try {
        const skillDirs = await fs.readdir(skillsDir, { withFileTypes: true });

        for (const skillDir of skillDirs) {
          if (!skillDir.isDirectory()) continue;

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
async function discoverAllSkills(directory: string): Promise<Map<string, SkillMetadata>> {
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

  const skillsByName = new Map<string, SkillMetadata>();

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
function resolveSkill(
  skillName: string,
  skillsByName: Map<string, SkillMetadata>
): SkillMetadata | null {
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

/**
 * Check if a path is safely within a base directory (no escape via ..)
 */
function isPathSafe(basePath: string, requestedPath: string): boolean {
  const resolved = path.resolve(basePath, requestedPath);
  return resolved.startsWith(basePath + path.sep) || resolved === basePath;
}

export const SkillsPlugin: Plugin = async ({ client, $, directory }) => {
  // Discover all skills at startup
  const skillsByName = await discoverAllSkills(directory);
  const allSkills = Array.from(skillsByName.values());

  // Cache session models to avoid model-switching bug (opencode issue #4475)
  // When using noReply, we need to pass the current model explicitly
  const sessionModels = new Map<string, { providerID: string; modelID: string }>();

  /**
   * Get the current model for a session.
   * Uses cache first, falls back to querying session messages.
   * This is needed to work around opencode issue #4475 where noReply
   * prompts without an explicit model cause model switching.
   */
  async function getCurrentModel(
    sessionID: string,
    limit: number = 50
  ): Promise<{ providerID: string; modelID: string } | undefined> {
    // Fast path: use cached model
    const cached = sessionModels.get(sessionID);
    if (cached) return cached;

    // Slow path: query session messages
    try {
      const response = await client.session.messages({
        path: { id: sessionID },
        query: { limit }
      });

      if (response.data) {
        for (const msg of response.data) {
          if (msg.info.role === "user" && "model" in msg.info && msg.info.model) {
            const model = msg.info.model;
            sessionModels.set(sessionID, model); // Cache for future
            return model;
          }
        }
      }
    } catch {
      // On error, return undefined (let opencode use its default)
    }

    return undefined;
  }

  const injectedSessions = new Set<string>();
  const usingSuperpowersSkill = skillsByName.get('using-superpowers');

  // Check env var for superpowers mode
  const superpowersModeEnabled = process.env.OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE === 'true';

  const toolMappingFull = `**Tool Mapping for OpenCode:**
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use the \`task\` tool with \`subagent_type\`
- \`Skill\` tool → \`use_skill\`
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\`, \`Glob\`, \`Grep\`, \`WebFetch\` → Use the native lowercase OpenCode tools`;

  const toolMappingCompact = '**Tool Mapping:** TodoWrite→todowrite, Task→task(@subagent), Skill→use_skill, Read/Write/Edit/Bash→native tools';

  const skillsNamespaceFull = `**Skill namespace priority:**
1. Project: \`project:skill-name\`
2. Claude project: \`claude-project:skill-name\`
3. User: \`skill-name\`
4. Claude user: \`claude-user:skill-name\`
5. Marketplace: \`claude-plugins:skill-name\`

The first discovered match wins.`;

  const skillsNamespaceCompact = '**Skill priority:** project → claude-project → user → claude-user → claude-plugins (first match wins).';

  const buildSuperpowersBootstrap = (compact: boolean): string | null => {
    if (!usingSuperpowersSkill) return null;

    const mapping = compact ? toolMappingCompact : toolMappingFull;
    const namespace = compact ? skillsNamespaceCompact : skillsNamespaceFull;

    return `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - do not call use_skill for it again. Use use_skill only for OTHER skills.**

${usingSuperpowersSkill.content}

${mapping}

${namespace}
</EXTREMELY_IMPORTANT>`;
  };




  const maybeInjectSuperpowersBootstrap = async (
    sessionID: string | undefined,
    reason: 'initial' | 'compaction'
  ) => {
    if (!sessionID) return;
    if (!superpowersModeEnabled) return;
    if (!usingSuperpowersSkill) return;

    const compact = reason === 'compaction';
    const content = buildSuperpowersBootstrap(compact);
    if (!content) return;

    const model = await getCurrentModel(sessionID);
    await injectSyntheticContent(client, sessionID, content, model);
  };

  // Tool translation guide for skills written for Claude Code
  const toolTranslation = `<tool-translation>
This skill may reference Claude Code tools. Use OpenCode equivalents:
- TodoWrite/TodoRead -> todowrite/todoread
- Task (subagents) -> task tool with subagent_type parameter
- Skill tool -> use_skill tool
- Read/Write/Edit/Bash/Glob/Grep/WebFetch -> lowercase (read/write/edit/bash/glob/grep/webfetch)
</tool-translation>`;

  const tools: Record<string, ToolDefinition> = {};


  return {
    "chat.message": async (_input, output) => {
      const sessionID = output.message.sessionID;

      // Cache the model for this session (to avoid model-switching bug #4475)
      if (output.message.model) {
        sessionModels.set(sessionID, output.message.model);
      }

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
      const model = await getCurrentModel(sessionID);
      await maybeInjectSuperpowersBootstrap(sessionID, 'initial');
      await injectSkillsList(client, sessionID, allSkills, model);
    },

    event: async ({ event }) => {
      // Re-inject skills list after context compaction
      if (event.type === 'session.compacted') {
        const sessionID = event.properties.sessionID;
        const model = await getCurrentModel(sessionID);
        await maybeInjectSuperpowersBootstrap(sessionID, 'compaction');
        await injectSkillsList(client, sessionID, allSkills, model);
      }
    },

    tool: {
      find_skills: tool({
        description: "List available skills with their descriptions. Optionally filter by query.",
        args: {
          query: tool.schema.string().optional()
            .describe("Search query to filter skills (matches name and description)")
        },
        async execute(args) {
          let filtered = allSkills;

          if (args.query) {
            const pattern = new RegExp(args.query.replace(/\*/g, '.*'), 'i');
            filtered = filtered.filter(s =>
              pattern.test(s.name) || pattern.test(s.description)
            );
          }

          if (filtered.length === 0) {
            return "No skills found matching your query.";
          }

          return filtered
            .map(s => {
              const scripts = s.scripts.length > 0
                ? ` [scripts: ${s.scripts.map(sc => sc.name).join(', ')}]`
                : '';
              return `${s.name} (${s.label})\n  ${s.description}${scripts}`;
            })
            .join('\n\n');
        }
      }),

      read_skill_file: tool({
        description: "Read a supporting file from a skill's directory (docs, examples, configs).",
        args: {
          skill_name: tool.schema.string()
            .describe("Name of the skill"),
          filename: tool.schema.string()
            .describe("File to read, relative to skill directory (e.g., 'anthropic-best-practices.md', 'scripts/helper.sh')")
        },
        async execute(args, ctx) {
          const skill = resolveSkill(args.skill_name, skillsByName);

          if (!skill) {
            return `Skill "${args.skill_name}" not found. Use find_skills to see available skills.`;
          }

          // Security: ensure path doesn't escape skill directory
          if (!isPathSafe(skill.path, args.filename)) {
            return `Invalid path: cannot access files outside skill directory.`;
          }

          const filePath = path.join(skill.path, args.filename);

          try {
            const content = await fs.readFile(filePath, 'utf-8');

            // Inject via noReply for context persistence
            const wrappedContent = `<skill-file skill="${skill.name}" file="${args.filename}">
  <metadata>
    <directory>${skill.path}</directory>
  </metadata>

  <content>
${content}
  </content>
</skill-file>`;

            const model = await getCurrentModel(ctx.sessionID);
            await injectSyntheticContent(client, ctx.sessionID, wrappedContent, model);

            return `File "${args.filename}" from skill "${skill.name}" loaded.`;
          } catch {
            // List available files on error
            try {
              const files = await fs.readdir(skill.path);
              return `File "${args.filename}" not found. Available files: ${files.join(', ')}`;
            } catch {
              return `File "${args.filename}" not found in skill "${skill.name}".`;
            }
          }
        }
      }),

      run_skill_script: tool({
        description: "Execute a script from a skill's directory. Scripts are run with the skill directory as CWD.",
        args: {
          skill_name: tool.schema.string()
            .describe("Name of the skill"),
          script_name: tool.schema.string()
            .describe("Name of the script to run (with or without extension)"),
          arguments: tool.schema.array(tool.schema.string()).optional()
            .describe("Arguments to pass to the script")
        },
        async execute(args) {
          const skill = resolveSkill(args.skill_name, skillsByName);

          if (!skill) {
            return `Skill "${args.skill_name}" not found. Use find_skills to see available skills.`;
          }

          // Find the script
          const script = skill.scripts.find(s =>
            s.name === args.script_name ||
            s.name === path.parse(args.script_name).name
          );

          if (!script) {
            const available = skill.scripts.map(s => s.name).join(', ') || 'none';
            return `Script "${args.script_name}" not found in skill "${skill.name}". Available scripts: ${available}`;
          }

          try {
            $.cwd(skill.path);
            const scriptArgs = args.arguments || [];
            const result = await $`${script.path} ${scriptArgs}`.text();
            return result;
          } catch (error: unknown) {
            if (error instanceof Error && 'exitCode' in error) {
              const shellError = error as Error & { exitCode: number; stderr?: Buffer; stdout?: Buffer };
              const stderr = shellError.stderr?.toString() || '';
              const stdout = shellError.stdout?.toString() || '';
              return `Script failed (exit ${shellError.exitCode}): ${stderr || stdout || shellError.message}`;
            }
            if (error instanceof Error) {
              return `Script failed: ${error.message}`;
            }
            return `Script failed: ${String(error)}`;
          }
        }
      }),

      use_skill: tool({
        description: "Load a skill's SKILL.md content into context. Skills contain proven workflows, techniques, and patterns.",
        args: {
          skill_name: tool.schema.string()
            .describe("Name of the skill (e.g., 'brainstorming', 'project:my-skill', 'user:my-skill')")
        },
        async execute(args, ctx) {
          const skill = resolveSkill(args.skill_name, skillsByName);

          if (!skill) {
            const available = allSkills.map(s => s.name).join(', ');
            return `Skill "${args.skill_name}" not found. Available skills: ${available}`;
          }

          // Get all files in the skill directory
          const skillFiles = await listSkillFiles(skill.path);

          const scriptsXml = skill.scripts.length > 0
            ? `\n    <scripts>\n${skill.scripts.map(s => `      <script>${s.name}</script>`).join('\n')}\n    </scripts>`
            : '';

          const filesXml = skillFiles.length > 0
            ? `\n    <files>\n${skillFiles.map(f => `      <file>${f}</file>`).join('\n')}\n    </files>`
            : '';

          const skillContent = `<skill name="${skill.name}">
  <metadata>
    <source>${skill.label}</source>
    <directory>${skill.path}</directory>${scriptsXml}${filesXml}
  </metadata>

  ${toolTranslation}

  <content>
${skill.content}
  </content>
</skill>`;

          const model = await getCurrentModel(ctx.sessionID);
          await injectSyntheticContent(client, ctx.sessionID, skillContent, model);

          const scriptInfo = skill.scripts.length > 0
            ? `\nAvailable scripts: ${skill.scripts.map(s => s.name).join(', ')}`
            : '';

          const filesInfo = skillFiles.length > 0
            ? `\nAvailable files: ${skillFiles.join(', ')}`
            : '';

          return `Skill "${skill.name}" loaded.${scriptInfo}${filesInfo}`;
        }
      }),
    }
  };
};
