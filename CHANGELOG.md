# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Automatically pin Pi sessions to separate llama.cpp slots when available, preserving explicit slot and cache settings.
- Inspect server slot activity and local session assignments with `/llama-slots`.

## [0.1.3] - 2026-11-16

### Changed

- Code-quality improvements around discovery timeouts; no behavior changes.

## [0.1.2] - 2026-11-14

### Fixed

- Send Pi’s thinking token budget with each native llama.cpp effort, respecting custom budgets and explicit overrides.
- Clarify README usage and discovery limits, correct the budget preview, and make the flow diagram display on the Pi package index.
- Clarify the package description and search keywords.

## [0.1.1] - 2026-11-13

### Added

- README information-flow diagram and a link to implementation details.

### Fixed

- Make README setup instructions easier to find and correct the MIT license badge.

## [0.1.0] - 2026-11-13

### Added

- Show loaded models’ native llama.cpp efforts in Pi’s thinking selector.
- Send the selected effort without changing token budgets or replacing the built-in provider.
- Visual README guide comparing Pi’s default controls with native effort selection.

### Fixed

- Correct refresh guidance: restart Pi after template capabilities change; `/reload` retains the active model’s efforts.

[Unreleased]: https://github.com/Ryu-CZ/pi-llama-reasoning/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Ryu-CZ/pi-llama-reasoning/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Ryu-CZ/pi-llama-reasoning/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Ryu-CZ/pi-llama-reasoning/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Ryu-CZ/pi-llama-reasoning/releases/tag/v0.1.0
