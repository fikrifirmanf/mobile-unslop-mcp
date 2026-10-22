import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { runCheck, projectDir, typescriptCheck, summarizeChecks, inside } from "unslop-core";

const LONG = 900_000;

async function xcodeCheck(cwd) {
  const project = readdirSync(cwd).find((f) => f.endsWith(".xcworkspace")) ?? readdirSync(cwd).find((f) => f.endsWith(".xcodeproj"));
  if (!project) return null;
  const flag = project.endsWith(".xcworkspace") ? "-workspace" : "-project";
  const list = await runCheck("xcodebuild", ["-list", "-json", flag, project], cwd);
  if (list.status !== "PASS") return { lang: "xcode", ...list };
  let scheme;
  try {
    const j = JSON.parse(list.output.slice(list.output.indexOf("{")));
    scheme = (j.workspace ?? j.project)?.schemes?.[0];
  } catch {
    scheme = undefined;
  }
  if (!scheme) return { lang: "xcode", status: "SKIPPED", cmd: "xcodebuild", output: "No shared scheme found." };
  return {
    lang: "xcode",
    ...(await runCheck("xcodebuild", [flag, project, "-scheme", scheme, "-destination", "generic/platform=iOS Simulator", "-quiet", "build", "CODE_SIGNING_ALLOWED=NO"], cwd, { timeout: LONG })),
  };
}

export async function verifyMobileBuild(args, root) {
  const cwd = projectDir(root, args.projectRoot);
  if (!cwd) return { status: "FAIL", message: "projectRoot is outside the workspace.", _failed: true };
  const full = args.mode === "full";
  const has = (f) => existsSync(path.join(cwd, f));
  const files = (Array.isArray(args.files) ? args.files : []).map((f) => path.resolve(root, f)).filter((f) => inside(root, f) && existsSync(f));
  const swift = files.filter((f) => f.endsWith(".swift"));
  const checks = [];

  if (swift.length && !full) checks.push({ lang: "swift", ...(await runCheck("xcrun", ["swiftc", "-parse", ...swift], cwd)) });
  if (full && has("Package.swift")) checks.push({ lang: "swift", ...(await runCheck("swift", ["build"], cwd, { timeout: LONG })) });
  else if (full) {
    const x = await xcodeCheck(has("ios") ? path.join(cwd, "ios") : cwd);
    if (x) checks.push(x);
  }

  const gradlew = ["gradlew", "android/gradlew"].find(has);
  if (gradlew && full) checks.push({ lang: "android", ...(await runCheck(path.join(cwd, gradlew), ["compileDebugSources", "--quiet"], path.dirname(path.join(cwd, gradlew)), { timeout: LONG })) });
  else if (gradlew || files.some((f) => /\.kts?$/.test(f))) checks.push({ lang: "android", status: "SKIPPED", cmd: "gradlew compileDebugSources", output: "Kotlin has no fast syntax-only check; call again with mode: \"full\" to compile." });

  if (has("pubspec.yaml")) checks.push({ lang: "flutter", ...(await runCheck("dart", ["analyze", "--fatal-warnings", ...(files.filter((f) => f.endsWith(".dart")).length ? files.filter((f) => f.endsWith(".dart")) : ["."])], cwd)) });
  if (has("tsconfig.json") && (has("app.json") || has("metro.config.js"))) checks.push(await typescriptCheck(cwd, root));

  return summarizeChecks(checks, { none: "No Swift files, Xcode/SwiftPM, Gradle, Flutter or React Native project detected; nothing verified." });
}
