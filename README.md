<p align="center">
  <a href="https://github.com/giovannicocco/openfrontier">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenFrontier logo">
    </picture>
  </a>
</p>
<p align="center">OpenFrontier is an open source AI coding agent.</p>
<p align="center">
  <a href="https://github.com/giovannicocco/openfrontier/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/giovannicocco/openfrontier/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenFrontier Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/giovannicocco/openfrontier)

---

### Installation

```bash
# From source
bun install
bun run --cwd packages/opencode build

# CLI package name/bin for this fork
openfrontier
```

> [!TIP]
> This fork is being rebranded from OpenCode to OpenFrontier. Some internal package names may still reference the upstream namespace while the migration is completed.

### Desktop App (BETA)

OpenFrontier also includes a desktop application. Release packaging should use the OpenFrontier product name and artifact names.

| Platform              | Download                                |
| --------------------- | --------------------------------------- |
| macOS (Apple Silicon) | `openfrontier-desktop-mac-arm64.dmg`    |
| macOS (Intel)         | `openfrontier-desktop-mac-x64.dmg`      |
| Windows               | `openfrontier-desktop-windows-x64.exe`  |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`          |

#### Installation Directory

The install script should respect the following priority order for the installation path:

1. `$OPENFRONTIER_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.openfrontier/bin` - Default fallback

```bash
# Examples
OPENFRONTIER_INSTALL_DIR=/usr/local/bin ./install.sh
XDG_BIN_DIR=$HOME/.local/bin ./install.sh
```

### Agents

OpenFrontier includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

### Documentation

Documentation for this fork will live in this repository while the OpenFrontier-specific docs are being finalized.

### Contributing

If you're interested in contributing to OpenFrontier, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenFrontier

If you are working on a project that's related to OpenFrontier and is using "openfrontier" as part of its name, for example "openfrontier-dashboard" or "openfrontier-mobile", please add a note to your README to clarify whether it is affiliated with this repository.

---
