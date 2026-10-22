import fs from "node:fs/promises";
import path from "node:path";
import { walk, projectDir, maskComments } from "unslop-core";

// API usage -> Info.plist purpose key(s). Any one of `keys` satisfies the requirement.
const IOS_APIS = [
  { api: /\bAVCaptureDevice\b|\bAVCaptureSession\b|sourceType\s*=\s*\.camera|\bVNDocumentCameraViewController\b|\bDataScannerViewController\b/, keys: ["NSCameraUsageDescription"] },
  { api: /\bPHPhotoLibrary\b(?![^\n]*\.addOnly)|\bPHAsset\.fetch/, keys: ["NSPhotoLibraryUsageDescription"] },
  { api: /\.addOnly\b|UIImageWriteToSavedPhotosAlbum|PHAssetCreationRequest/, keys: ["NSPhotoLibraryAddUsageDescription", "NSPhotoLibraryUsageDescription"] },
  { api: /\bCLLocationManager\b/, keys: ["NSLocationWhenInUseUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription"] },
  { api: /requestAlwaysAuthorization\(/, keys: ["NSLocationAlwaysAndWhenInUseUsageDescription"] },
  { api: /\bAVAudioRecorder\b|\.record\b[^\n]*AVAudioSession|AVAudioSession[^\n]*\.(?:record|playAndRecord)\b|\bAVAudioEngine\b[\s\S]{0,200}inputNode/, keys: ["NSMicrophoneUsageDescription"] },
  { api: /\bSFSpeechRecognizer\b/, keys: ["NSSpeechRecognitionUsageDescription"] },
  { api: /\bCNContactStore\b/, keys: ["NSContactsUsageDescription"] },
  { api: /\bEKEventStore\b/, keys: ["NSCalendarsFullAccessUsageDescription", "NSCalendarsUsageDescription", "NSCalendarsWriteOnlyAccessUsageDescription"] },
  { api: /requestFullAccessToReminders|entityType:\s*\.reminder/, keys: ["NSRemindersFullAccessUsageDescription", "NSRemindersUsageDescription"] },
  { api: /\bCBCentralManager\b|\bCBPeripheralManager\b/, keys: ["NSBluetoothAlwaysUsageDescription"] },
  { api: /\bATTrackingManager\b/, keys: ["NSUserTrackingUsageDescription"] },
  { api: /\bLAContext\b[\s\S]{0,400}\.deviceOwnerAuthentication/, keys: ["NSFaceIDUsageDescription"] },
  { api: /\bHKHealthStore\b/, keys: ["NSHealthShareUsageDescription"] },
  { api: /\bCMMotionActivityManager\b|\bCMPedometer\b/, keys: ["NSMotionUsageDescription"] },
  { api: /\bNFC(?:NDEF|Tag)ReaderSession\b/, keys: ["NFCReaderUsageDescription"] },
  { api: /\bMPMediaLibrary\b|\bMPMediaQuery\b/, keys: ["NSAppleMusicUsageDescription"] },
  { api: /\bNWBrowser\b|\bNetServiceBrowser\b|\bNWListener\b/, keys: ["NSLocalNetworkUsageDescription"] },
];
// "Required reason" APIs that need a PrivacyInfo.xcprivacy declaration (App Store Connect rejects without it).
const REQUIRED_REASON = /\bUserDefaults\b|\.creationDate\b|\.modificationDate\b|\bsystemUptime\b|\bmach_absolute_time\b|volumeAvailableCapacity|\bstatfs\b|\bactiveInputModes\b/;

const ANDROID_APIS = [
  { api: /\bCameraX\b|\bProcessCameraProvider\b|\bCameraManager\b|MediaStore\.ACTION_IMAGE_CAPTURE|Manifest\.permission\.CAMERA/, perms: ["android.permission.CAMERA"] },
  { api: /\bFusedLocationProviderClient\b|\bLocationManager\b|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/, perms: ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"] },
  { api: /\bMediaRecorder\b|\bAudioRecord\b|\bSpeechRecognizer\b|Manifest\.permission\.RECORD_AUDIO/, perms: ["android.permission.RECORD_AUDIO"] },
  { api: /\bBluetoothLeScanner\b|\bBluetoothGatt\b|BLUETOOTH_CONNECT|BLUETOOTH_SCAN/, perms: ["android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH"] },
  { api: /\bNotificationManagerCompat\b[\s\S]{0,200}\.notify\(|POST_NOTIFICATIONS/, perms: ["android.permission.POST_NOTIFICATIONS"] },
  { api: /\bRetrofit\b|\bOkHttpClient\b|\bHttpURLConnection\b|\bKtor\b|\bHttpClient\s*\(|\bVolley\b/, perms: ["android.permission.INTERNET"] },
  { api: /ContactsContract|READ_CONTACTS/, perms: ["android.permission.READ_CONTACTS"] },
  { api: /\bBiometricPrompt\b/, perms: ["android.permission.USE_BIOMETRIC"] },
  { api: /\bVibrator\b|\bVibratorManager\b/, perms: ["android.permission.VIBRATE"] },
];
const DANGEROUS = /android\.permission\.(?:CAMERA|RECORD_AUDIO|ACCESS_(?:FINE|COARSE|BACKGROUND)_LOCATION|READ_CONTACTS|WRITE_CONTACTS|READ_CALENDAR|WRITE_CALENDAR|READ_SMS|SEND_SMS|READ_CALL_LOG|READ_PHONE_STATE|CALL_PHONE|BODY_SENSORS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_\w+|MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES)/g;

const rel = (root, p) => path.relative(root, p);
const read = (p) => fs.readFile(p, "utf8").catch(() => "");

function plistKeys(xml) {
  const keys = new Map();
  for (const m of xml.matchAll(/<key>([\w.]+)<\/key>\s*<string>([^<]*)<\/string>/g)) keys.set(m[1], m[2].trim());
  for (const m of xml.matchAll(/<key>([\w.]+)<\/key>/g)) if (!keys.has(m[1])) keys.set(m[1], "");
  return keys;
}

async function checkIos(root, all, issues) {
  const plists = all.filter((f) => /(?:^|[/\\])Info\.plist$/.test(f) && !/Tests?[/\\]|Pods[/\\]/.test(f));
  const swift = all.filter((f) => /\.(?:swift|mm?)$/.test(f) && !/Tests?[/\\]/.test(f));
  const expoKeys = new Map();
  for (const f of all.filter((p) => /(?:^|[/\\])app\.json$/.test(p))) {
    try {
      const plist = JSON.parse(await read(f)).expo?.ios?.infoPlist ?? {};
      for (const [k, v] of Object.entries(plist)) expoKeys.set(k, String(v));
    } catch {
      issues.push({ severity: "ERROR", rule: "APP_JSON_INVALID", file: rel(root, f), message: "app.json is not valid JSON." });
    }
  }
  if (!swift.length && !plists.length) return null;

  const keys = new Map(expoKeys);
  for (const p of plists) for (const [k, v] of plistKeys(await read(p))) keys.set(k, v);
  const code = (await Promise.all(swift.map(async (f) => [f, maskComments(await read(f), f)])));

  for (const { api, keys: need } of IOS_APIS) {
    const hit = code.find(([, src]) => api.test(src));
    if (hit && !need.some((k) => keys.has(k))) {
      issues.push({ severity: "ERROR", rule: "IOS_MISSING_PURPOSE_STRING", file: rel(root, hit[0]), message: `Code uses ${hit[1].match(api)[0].trim()} but Info.plist has no ${need.join(" / ")}. The app crashes on first access and App Review rejects it.` });
    }
  }
  for (const [k] of keys) {
    if (!/UsageDescription$/.test(k) || /^NSLocation|^NSPhotoLibrary/.test(k)) continue;
    const used = IOS_APIS.some(({ api, keys: need }) => need.includes(k) && code.some(([, src]) => api.test(src)));
    if (!used && code.length) issues.push({ severity: "WARN", rule: "IOS_UNUSED_PURPOSE_STRING", file: plists[0] ? rel(root, plists[0]) : "app.json", message: `${k} is declared but no matching API use was found. Remove it, or ignore this if a dependency needs it.` });
  }
  const reasonHit = code.find(([, src]) => REQUIRED_REASON.test(src));
  if (reasonHit && !all.some((f) => f.endsWith("PrivacyInfo.xcprivacy"))) {
    issues.push({ severity: "WARN", rule: "IOS_MISSING_PRIVACY_MANIFEST", file: rel(root, reasonHit[0]), message: `Uses a "required reason" API (${reasonHit[1].match(REQUIRED_REASON)[0]}) but there is no PrivacyInfo.xcprivacy. App Store Connect rejects uploads without declared reasons.` });
  }
  return { plists: plists.map((p) => rel(root, p)), sourceFiles: swift.length, purposeKeys: [...keys.keys()].filter((k) => /UsageDescription$/.test(k)) };
}

async function checkAndroid(root, all, issues) {
  const manifests = all.filter((f) => f.endsWith("AndroidManifest.xml") && !/[/\\](?:build|androidTest|test)[/\\]/.test(f));
  const sources = all.filter((f) => /\.(?:kt|java)$/.test(f) && !/[/\\](?:test|androidTest)[/\\]/.test(f));
  if (!manifests.length) return sources.length ? (issues.push({ severity: "WARN", rule: "ANDROID_NO_MANIFEST", file: ".", message: "Kotlin/Java sources but no AndroidManifest.xml found under projectRoot." }), {}) : null;

  const xml = (await Promise.all(manifests.map(read))).join("\n");
  const declared = new Set([...xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1]));
  const code = await Promise.all(sources.map(async (f) => [f, maskComments(await read(f), f)]));

  for (const { api, perms } of ANDROID_APIS) {
    const hit = code.find(([, src]) => api.test(src));
    if (hit && !perms.some((p) => declared.has(p))) {
      issues.push({ severity: "ERROR", rule: "ANDROID_MISSING_PERMISSION", file: rel(root, hit[0]), message: `Code uses ${hit[1].match(api)[0]} but no manifest declares ${perms.join(" / ")}. It throws SecurityException or silently fails at runtime.` });
    }
  }
  for (const perm of new Set([...xml.matchAll(DANGEROUS)].map((m) => m[0]))) {
    const used = ANDROID_APIS.some(({ api, perms }) => perms.includes(perm) && code.some(([, src]) => api.test(src))) || code.some(([, src]) => src.includes(perm.split(".").pop()));
    if (!used && code.length) issues.push({ severity: "WARN", rule: "ANDROID_UNUSED_DANGEROUS_PERMISSION", file: rel(root, manifests[0]), message: `${perm} is declared but never requested in code. Play Console flags unused sensitive permissions; remove it.` });
  }
  for (const m of xml.matchAll(/<(activity|service|receiver|activity-alias)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    if (/<intent-filter/.test(m[3]) && !/android:exported=/.test(m[2])) {
      const name = m[2].match(/android:name="([^"]+)"/)?.[1] ?? m[1];
      issues.push({ severity: "ERROR", rule: "ANDROID_EXPORTED_MISSING", file: rel(root, manifests[0]), message: `${name} has an intent-filter but no android:exported. Required on targetSdk 31+; installation fails.` });
    }
  }
  return { manifests: manifests.map((p) => rel(root, p)), sourceFiles: sources.length, permissions: [...declared] };
}

export async function verifyAppManifest(args, root) {
  const base = projectDir(root, args.projectRoot);
  if (!base) return { status: "FAIL", message: "projectRoot is outside the workspace.", _failed: true };
  const all = await walk(base, (p) => /\.(?:swift|mm?|kt|java|plist|xml|xcprivacy|json)$/.test(p));
  const issues = [];
  const ios = await checkIos(root, all, issues);
  const android = await checkAndroid(root, all, issues);
  if (!ios && !android) return { status: "SKIPPED", message: "No iOS (Info.plist/Swift) or Android (AndroidManifest.xml) project found under projectRoot." };
  const failed = issues.some((i) => i.severity === "ERROR");
  return {
    status: failed ? "FAIL" : "PASS",
    ...(ios ? { ios } : {}),
    ...(android ? { android } : {}),
    issues,
    instruction: failed ? "Add the missing purpose strings/permissions (with specific, user-facing reasons) and re-run." : "Manifest declarations match the APIs in use.",
    _failed: failed,
  };
}
