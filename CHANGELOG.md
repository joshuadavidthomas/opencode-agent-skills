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

[unreleased]: https://github.com/joshuadavidthomas/opencode-agent-skills/compare/v0.3.2...HEAD
[0.1.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.1.0
[0.2.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.2.0
[0.3.0]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.0
[0.3.1]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.1
[0.3.2]: https://github.com/joshuadavidthomas/opencode-agent-skills/releases/tag/v0.3.2
