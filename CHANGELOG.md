# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project attempts to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
## [${version}]
### Added - for new features
### Changed - for changes in existing functionality
### Deprecated - for soon-to-be removed features
### Removed - for now removed features
### Fixed - for any bug fixes
### Security - in case of vulnerabilities
[${version}]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v${version}
-->

## [Unreleased]

## [0.6.0]

### Added

- Semantic skill matching: after the initial skills list injection, subsequent messages are matched against skill descriptions using local embeddings
- Added `@huggingface/transformers` dependency for local embedding generation (quantized all-MiniLM-L6-v2)
- When a message matches available skills, injects a 3-step evaluation prompt (EVALUATE → DECIDE → ACTIVATE) to encourage skill loading (inspired by [@spences10](https://github.com/spences10)'s [blog post](https://scottspence.com/posts/how-to-make-claude-code-skills-activate-reliably))
- Disk-cached embeddings for low-latency matching (~/.cache/opencode-agent-skills/)
- Session cleanup on `session.deleted` event

## [0.5.0]

### Added

- Added "Did you mean..." fuzzy matching suggestions when skill or script names are not found in all tools (`use_skill`, `read_skill_file`, `run_skill_script`, `get_available_skills`)

### Changed

- **BREAKING**: Renamed `find_skills` tool to `get_available_skills` for clearer intent
- **Internal**: Reorganized codebase into separate modules (`claude.ts`, `skills.ts`, `tools.ts`, `utils.ts`, `superpowers.ts`) for better maintainability
- **Internal**: Improved code quality by removing AI-generated comments and unnecessary code

## [0.4.1]

### Changed

- Installation method now uses npm package via OpenCode config instead of git clone + symlink

### Removed

- Removed `INSTALL.md` (no longer needed with simplified installation)

## [0.4.0]

### Changed

- Script discovery now recursively searches the entire skill directory (max depth 10) instead of only the root and `scripts/` subdirectory
- Scripts are now identified by relative path (e.g., `tools/build.sh`) instead of base name
- Renamed `skill_name` parameter to `skill` in `read_skill_file`, `run_skill_script`, and `use_skill` tools
- Renamed `script_name` parameter to `script` in `run_skill_script` tool

## [0.3.3]

### Fixed

- Fixed file and directory detection to properly handle symlinks by using `fs.stat`

## [0.3.2]

### Fixed

- Preserve agent mode when injecting synthetic messages on session start

## [0.3.1]

### Fixed

- Fixed unintended model switching when using skill tools by explicitly passing the current model during `noReply` operations (workaround for opencode issue #4475)

## [0.3.0]

### Added

- Added file listing to `use_skill` output

## [0.2.0]

### Added

- Added support for superpowers mode
- Added release attestations

## [0.1.0]

### Added

- Added `use_skill` tool to load skill content into context
- Added `read_skill_file` tool to read supporting files from skill directories
- Added `run_skill_script` tool to execute scripts from skill directories
- Added `find_skills` tool to search and list available skills
- Added multi-location skill discovery (project, user, and Claude-compatible locations)
- Added Anthropic Agent Skills Spec v1.0 compliant frontmatter validation
- Added automatic skills list injection on session start and after context compaction

### New Contributors

- Josh Thomas <josh@joshthomas.dev> (maintainer)

[unreleased]: https://github.com/joshuadavidthomas/opencode-agent-skills/compare/v0.6.0...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.1.0
[0.2.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.2.0
[0.3.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.0
[0.3.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.1
[0.3.2]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.2
[0.3.3]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.3
[0.4.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.4.0
[0.4.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.4.1
[0.5.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.5.0
[0.6.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.6.0
