# opencode-agent-skills

A dynamic skills plugin for OpenCode that provides tools for loading and using reusable AI agent skills.

## Installation

Tell OpenCode:

```
Fetch and follow instructions from https://raw.githubusercontent.com/joshuadavidthomas/opencode-agent-skills/refs/heads/main/INSTALL.md
```

Or install manually:

```bash
git clone https://github.com/joshuadavidthomas/opencode-agent-skills ~/.config/opencode/opencode-agent-skills
mkdir -p ~/.config/opencode/plugin
ln -sf ~/.config/opencode/opencode-agent-skills/src/plugin.ts ~/.config/opencode/plugin/skills.ts
```

Restart OpenCode and you're ready to go.

## Usage

This plugin provides 4 tools to OpenCode:

| Tool | Description |
|------|-------------|
| `use_skill` | Load a skill's SKILL.md into context |
| `read_skill_file` | Read supporting files from a skill directory |
| `run_skill_script` | Execute scripts from a skill directory |
| `find_skills` | Search and list available skills |

### Skill Discovery

Skills are discovered from multiple locations in priority order. The first skill found with a given name wins -- there is no duplication or shadowing. This allows project-level skills to override user-level skills of the same name.

1. `.opencode/skills/` (project)
2. `.claude/skills/` (project, Claude compatibility)
3. `~/.config/opencode/skills/` (user)
4. `~/.claude/skills/` (user, Claude compatibility)
5. `~/.claude/plugins/marketplaces/` (installed Claude plugins)

### Writing Skills

Skills follow the [Anthropic Agent Skills Spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure). Each skill is a directory containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: A brief description of what this skill does
---

# My Skill

Instructions for the AI agent...
```

See the [Anthropic Agent Skills documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) for more details.

## How it works

### Synthetic Message Injection

When you load a skill with `use_skill`, the content is injected into the conversation using OpenCode's SDK with two key flags:

- `noReply: true` - The agent doesn't respond to the injection itself
- `synthetic: true` - Marks the message as synthetic, which survives context compaction

This means skills become part of the persistent conversation context and remain available even as the session grows and OpenCode compacts older messages.

### Session Initialization

On session start, the plugin automatically injects a list of all discovered skills wrapped in `<available-skills>` tags. This allows the agent to know what skills are available without needing to call `find_skills` first.

### Superpowers Mode (optional)

To get the strict Superpowers prompt, install the real Superpowers project (follow [their instructions](https://github.com/obra/superpowers)). We automatically pick up the `using-superpowers` skill from either of its supported homes:

- Installed as a Claude Code plugin (skills live under `.claude/plugins/…`)
- Installed as the Superpowers OpenCode plugin (skills live under `.opencode/skills/…`)

Once Superpowers is installed, enable superpowers mode via environment variable:

```bash
OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true opencode
```

Or export it in your shell profile for persistent use:

```bash
export OPENCODE_AGENT_SKILLS_SUPERPOWERS_MODE=true
```

The plugin will inject the full prompt when a session starts and a compact reminder after compaction.

### Compaction Resilience

The plugin listens for `session.compacted` events and re-injects the available skills list. Combined with the `synthetic: true` flag on loaded skills, this ensures the agent maintains access to skills throughout long sessions.

## Alternatives

- [opencode-skills](https://github.com/malhashemi/opencode-skills) - Auto-discovers skills and registers each as a dynamic `skills_{{name}}` tool
- [superpowers](https://github.com/obra/superpowers) - A complete software development workflow built on composable skills
- [skillz](https://github.com/intellectronica/skillz) - An MCP server that exposes skills as tools to any MCP client

## License

opencode-agent-skills is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
