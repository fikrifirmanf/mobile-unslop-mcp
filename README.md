# mobile-unslop-mcp

> Stop AI-written mobile code from crashing on users' phones or getting rejected at review: skill + MCP verifier for iOS (Swift/SwiftUI), Android (Kotlin/Compose), React Native and Flutter.

[![npm](https://img.shields.io/npm/v/mobile-unslop-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/mobile-unslop-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)

An **agent skill** plus an **MCP server** in one package. The skill tells your coding agent what slop to avoid; the MCP tools then *deterministically verify* the result, so the agent can't just claim it's done.

Works with **Claude Code**, **Claude Desktop**, **Codex** and **Antigravity**.

## What it catches

| Rule | Severity | Catches |
| --- | --- | --- |
| `SWIFT_FORCE_TRY` | ERROR | `try!` crashes the app on any thrown error. Use do/catch or `try?` with a fallback. |
| `SWIFT_FORCE_CAST` | ERROR | `as!` crashes when the cast fails. Use `as?` with guard/if-let. |
| `SWIFT_FORCE_UNWRAP` | WARN | Force unwrap `!` crashes on nil. Use guard let / if let / ?? default. |
| `SWIFT_MAIN_SYNC` | ERROR | DispatchQueue.main.sync deadlocks when called from the main thread. Use @MainActor / await MainActor.run / main.async. |
| `SWIFT_FIXED_FONT_SIZE` | WARN | Fixed font size ignores Dynamic Type. Use text styles (.font(.body)) or scale with relativeTo / UIFontMetrics. |
| `SWIFT_DEVICE_SIZE_HARDCODE` | ERROR | Layout hardcoded to one device width (or UIScreen.main, deprecated for multi-window). Use flexible frames, GeometryReader or containerRelativeFrame. |
| `SWIFT_ICON_BUTTON_UNLABELLED` | ERROR | Icon-only Button without an accessibility label: VoiceOver reads the SF Symbol name. Use Label("Delete", systemImage:) or .accessibilityLabel. |
| `SWIFTUI_ONAPPEAR_TASK` | WARN | .onAppear { Task { } } leaks work after the view disappears. Use .task { }, which is cancelled automatically. |
| `SWIFT_ANYVIEW` | WARN | AnyView erases identity and defeats SwiftUI diffing. Use @ViewBuilder, generics or `some View`. |
| `SWIFT_PRINT_LOGGING` | WARN | print() logging ships to production and cannot be filtered. Use os.Logger with a subsystem/category. |
| `KOTLIN_GLOBALSCOPE` | ERROR | GlobalScope coroutines outlive the screen and leak. Use viewModelScope / lifecycleScope / an injected scope. |
| `BLOCKING_SLEEP` | ERROR | Thread.sleep/runBlocking blocks the calling thread (ANR on main). Use delay() inside a coroutine. |
| `KOTLIN_NOT_NULL_ASSERTION` | WARN | `!!` throws NullPointerException. Use ?.let, ?: or requireNotNull with a message. |
| `COMPOSE_ICON_BUTTON_NULL_DESCRIPTION` | ERROR | IconButton whose icon has contentDescription = null is unlabeled for TalkBack. Describe the action. |
| `COMPOSE_STATE_WITHOUT_REMEMBER` | ERROR | mutableStateOf without remember resets on every recomposition. Wrap in remember { } (or rememberSaveable). |
| `COMPOSE_HARDCODED_STRING` | WARN | Hardcoded UI string can't be translated. Use stringResource(R.string.x). |
| `ANDROID_LOG_DEBUG` | WARN | Debug logging ships in release builds. Use Timber with a release tree, or strip with R8 rules. |
| `ANDROID_CLEARTEXT_TRAFFIC` | ERROR | Cleartext HTTP enabled app-wide. Use HTTPS; scope exceptions to specific debug domains in network_security_config. |
| `ANDROID_DEBUGGABLE` | ERROR | android:debuggable hardcoded in the manifest ships debuggable release builds. Let the build type set it. |
| `ANDROID_ALLOW_BACKUP` | WARN | allowBackup without backup rules copies tokens and databases to cloud/adb backups. Add dataExtractionRules or disable. |
| `IOS_ATS_ARBITRARY_LOADS` | ERROR | App Transport Security disabled for all domains (App Review asks for justification). Use HTTPS or a per-domain NSExceptionDomains entry. |
| `IOS_VAGUE_PURPOSE_STRING` | ERROR | Empty or vague permission purpose string: App Review rejects these (guideline 5.1.1). Say what the feature does with the data. |
| `INSECURE_TOKEN_STORAGE` | ERROR | Credential stored in plain preferences (UserDefaults/SharedPreferences/AsyncStorage). Use Keychain, EncryptedSharedPreferences/Keystore, expo-secure-store or flutter_secure_storage. |
| `RN_SCROLLVIEW_MAP` | WARN | ScrollView + .map renders every row at once. Use FlatList/FlashList for lists. |
| `RN_TOUCHABLE_UNLABELLED` | WARN | Icon-only touchable without accessibilityLabel/accessibilityRole is invisible to screen readers. |
| `FLUTTER_SETSTATE_AFTER_AWAIT` | WARN | setState after an await without a `mounted` check throws if the widget was disposed. Add `if (!mounted) return;`. |
| `FLUTTER_PRINT` | WARN | print() ships to release logs. Use debugPrint or package:logging. |

`verify_app_manifest` cross-checks the platform APIs your code uses against Info.plist purpose strings (and Expo `app.json`), `PrivacyInfo.xcprivacy`, and AndroidManifest permissions and `android:exported` flags: the mistakes that crash on first use or fail App Review / Play Console.

Rules marked **ERROR** make the audit return `status: "FAIL"`; **WARN** is reported but does not fail.

## Quick start

### 1. Add the MCP server

```bash
# Claude Code
claude mcp add mobile-unslop -s user -- npx -y mobile-unslop-mcp

# Codex
codex mcp add mobile-unslop -- npx -y mobile-unslop-mcp
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`) and **Antigravity** (`~/.gemini/config/mcp_config.json`):

```json
{
  "mcpServers": {
    "mobile-unslop": {
      "command": "npx",
      "args": ["-y", "mobile-unslop-mcp"]
    }
  }
}
```

Restart the app afterwards.

### 2. Install the bundled skill

```bash
npx -y mobile-unslop-mcp install-skills        # clients that are installed
npx -y mobile-unslop-mcp install-skills --all  # every location
```

| Client | Location |
| --- | --- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Antigravity | `~/.gemini/config/skills/` (and `~/.gemini/antigravity/skills/` if present) |

Claude Desktop has no skills folder, so it receives the rules through the MCP prompt and the `load_*_rules` tool.

## MCP surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Prompt | `mobile-unslop` | The full skill text, for GUI clients |
| Tool | `load_mobile_unslop_rules` | Returns the full mobile-unslop ruleset. Call before writing code if the mobile-unslop skill is not already loaded. |
| Tool | `audit_mobile_slop` | Deterministically scans Swift, Kotlin/Java, Dart, React Native and manifest files for mobile slop: crash operators (try!, as!, !, !!), main-thread deadlocks and blocking sleeps, GlobalScope, missing remember, Dynamic Type and device-size hardcodes, unlabelled icon buttons, insecure token storage, cleartext traffic, ATS disabled, vague permission strings and release logging. Accepts files or directories; with no files it audits the git working-tree changes. Suppress a verified false positive with a `unslop-ignore RULE_ID -- reason` comment on or above the line. |
| Tool | `verify_app_manifest` | Cross-checks platform APIs used in code against Info.plist purpose strings (and Expo app.json), PrivacyInfo.xcprivacy and AndroidManifest permissions/exported flags. Catches crash-on-first-use and App Review / Play Console rejections. Run after adding any camera, location, photos, mic, contacts, Bluetooth, health, notification or network feature. |
| Tool | `verify_mobile_build` | Verifies the app compiles. mode 'syntax' (default, fast): swiftc -parse on given Swift files, dart analyze, tsc for React Native. mode 'full': swift build / xcodebuild (simulator, no signing) and ./gradlew compileDebugSources; can take minutes. Missing toolchains are SKIPPED. |

File paths resolve against the server's working directory and cannot escape it. Directories honour `.gitignore` and skip `node_modules`, build output and minified files.

## CLI and CI

The same audit runs without an agent. It exits `1` on any ERROR, so it works as a pre-commit hook or CI step:

```bash
npx -y mobile-unslop-mcp audit              # git working-tree changes
npx -y mobile-unslop-mcp audit src app      # files or directories
npx -y mobile-unslop-mcp audit src --json   # machine-readable
npx -y mobile-unslop-mcp rules              # list every rule
```

## Suppressing a false positive

The checks are regex and structure based: fast, offline and predictable, but heuristic. For a verified false positive, add a comment on the line or the line above, **with a reason**:

```js
// unslop-ignore SWIFT_FORCE_TRY -- why this is safe here
```

Suppressions without a reason are reported as `SUPPRESSION_WITHOUT_REASON` errors, and every honoured suppression is listed in the audit output so reviewers can see it.

## How it works

1. The agent loads the skill and writes code under its constraints.
2. Before finishing, the skill requires the audit and verification tools.
3. On `FAIL`, the agent fixes every finding and re-runs until `PASS`. Missing toolchains are reported as `SKIPPED`, never as passing.

## The unslop family

- [`backend-unslop-mcp`](https://github.com/fikrifirmanf/backend-unslop-mcp)
- [`frontend-unslop-mcp`](https://github.com/fikrifirmanf/frontend-unslop-mcp)
- [`ui-unslop-mcp`](https://github.com/fikrifirmanf/ui-unslop-mcp)
- [`copy-unslop-mcp`](https://github.com/fikrifirmanf/copy-unslop-mcp)
- [`test-unslop-mcp`](https://github.com/fikrifirmanf/test-unslop-mcp)

All share the engine in [`unslop-core`](https://github.com/fikrifirmanf/unslop-core).

## Development

```bash
git clone https://github.com/fikrifirmanf/mobile-unslop-mcp
cd mobile-unslop-mcp && npm install
npm test                   # every rule is checked against its good/bad examples
node src/server.mjs        # speaks MCP over stdio
```

## License

MIT © Fikri Firman Fadilah
