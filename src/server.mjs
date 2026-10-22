#!/usr/bin/env node
import { run, byExt } from "unslop-core";
import { rules } from "./rules.mjs";
import { verifyAppManifest } from "./manifest.mjs";
import { verifyMobileBuild } from "./build.mjs";

await run({
  packageUrl: new URL("../package.json", import.meta.url),
  skill: "mobile-unslop",
  description: "Mobile anti-slop rules for iOS (Swift/SwiftUI), Android (Kotlin/Compose), React Native and Flutter.",
  auditTool: "audit_mobile_slop",
  auditDescription:
    "Deterministically scans Swift, Kotlin/Java, Dart, React Native and manifest files for mobile slop: crash operators (try!, as!, !, !!), main-thread deadlocks and blocking sleeps, GlobalScope, missing remember, Dynamic Type and device-size hardcodes, unlabelled icon buttons, insecure token storage, cleartext traffic, ATS disabled, vague permission strings and release logging.",
  rules,
  accept: byExt(".swift", ".m", ".mm", ".kt", ".kts", ".java", ".dart", ".tsx", ".jsx", ".ts", ".js", ".plist", ".xml"),
  tools: [
    {
      name: "verify_app_manifest",
      description:
        "Cross-checks platform APIs used in code against Info.plist purpose strings (and Expo app.json), PrivacyInfo.xcprivacy and AndroidManifest permissions/exported flags. Catches crash-on-first-use and App Review / Play Console rejections. Run after adding any camera, location, photos, mic, contacts, Bluetooth, health, notification or network feature.",
      inputSchema: { type: "object", properties: { projectRoot: { type: "string", description: "Relative app dir (default '.')" } } },
      handler: verifyAppManifest,
    },
    {
      name: "verify_mobile_build",
      description:
        "Verifies the app compiles. mode 'syntax' (default, fast): swiftc -parse on given Swift files, dart analyze, tsc for React Native. mode 'full': swift build / xcodebuild (simulator, no signing) and ./gradlew compileDebugSources; can take minutes. Missing toolchains are SKIPPED.",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string", description: "Relative app dir (default '.')" },
          files: { type: "array", items: { type: "string" }, description: "Modified files (Swift files enable the fast parse check)" },
          mode: { type: "string", enum: ["syntax", "full"] },
        },
      },
      handler: verifyMobileBuild,
    },
  ],
});
