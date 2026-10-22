import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRuleExamples } from "unslop-core";
import { rules } from "../src/rules.mjs";
import { verifyAppManifest } from "../src/manifest.mjs";

test("every rule catches its bad examples and passes its good ones", () => {
  assert.deepEqual(checkRuleExamples(rules), []);
});

async function project(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mobile-unslop-"));
  for (const [f, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await fs.writeFile(path.join(dir, f), body);
  }
  return dir;
}

test("iOS: API use without a purpose string fails", async () => {
  const dir = await project({
    "App/Info.plist": "<plist><dict><key>NSContactsUsageDescription</key><string>Find friends who already use the app.</string></dict></plist>",
    "App/Scanner.swift": "import AVFoundation\nlet session = AVCaptureSession()\n",
  });
  const r = await verifyAppManifest({}, dir);
  assert.equal(r.status, "FAIL");
  assert.ok(r.issues.some((i) => i.rule === "IOS_MISSING_PURPOSE_STRING" && /NSCameraUsageDescription/.test(i.message)));
  assert.ok(r.issues.some((i) => i.rule === "IOS_UNUSED_PURPOSE_STRING" && /NSContacts/.test(i.message)));
});

test("Android: missing permission and exported flag fail", async () => {
  const dir = await project({
    "app/src/main/AndroidManifest.xml": '<manifest><application><activity android:name=".Main"><intent-filter><action android:name="android.intent.action.MAIN"/></intent-filter></activity></application></manifest>',
    "app/src/main/java/Api.kt": "val client = OkHttpClient()\n",
  });
  const r = await verifyAppManifest({}, dir);
  assert.equal(r.status, "FAIL");
  assert.deepEqual(r.issues.map((i) => i.rule).sort(), ["ANDROID_EXPORTED_MISSING", "ANDROID_MISSING_PERMISSION"]);
});

test("declared and used is a PASS", async () => {
  const dir = await project({
    "app/src/main/AndroidManifest.xml": '<manifest><uses-permission android:name="android.permission.INTERNET"/><application/></manifest>',
    "app/src/main/java/Api.kt": "val client = OkHttpClient()\n",
  });
  assert.equal((await verifyAppManifest({}, dir)).status, "PASS");
});
