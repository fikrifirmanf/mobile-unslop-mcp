const SWIFT = /\.swift$/;
const KT = /\.kts?$/;
const ANDROID_SRC = /\.(?:kt|java)$/;
const DART = /\.dart$/;
const JSX = /\.[jt]sx?$/;
const TEST_FILE = /(?:^|[/\\])(?:tests?|androidTest|UITests|Tests)[/\\]|(?:Tests?|Spec)\.(?:swift|kt|java)$|_test\.dart$|\.(?:test|spec)\.[jt]sx?$/;

function swiftForceUnwrap(src) {
  const out = [];
  // Blank string literals so "Welcome back!" is not read as an unwrap.
  const lines = src.replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => `"${" ".repeat(s.length - 2)}"`).split("\n");
  let offset = 0;
  for (const line of lines) {
    // Implicitly unwrapped outlets are the platform idiom; `!=` / `!==` / prefix `!x` are not unwraps.
    if (!/@IBOutlet|@IBAction/.test(line)) {
      for (const m of line.matchAll(/[\w)\]]!(?=[.,)\]\s;?]|$)(?!=)/g)) {
        if (!/\b(?:try|as)!$/.test(line.slice(0, m.index + 2))) out.push({ index: offset + m.index });
      }
    }
    offset += line.length + 1;
  }
  return out;
}

function swiftImageButtonUnlabelled(src) {
  const out = [];
  for (const m of src.matchAll(/\bButton\b[^\n]*\{\s*Image\(systemName:|label:\s*\{\s*Image\(systemName:/g)) {
    const tail = src.slice(m.index, m.index + 400);
    if (!/accessibilityLabel|Label\(|Text\(/.test(tail)) out.push({ index: m.index });
  }
  return out;
}

function flutterSetStateAfterAwait(src) {
  const out = [];
  for (const m of src.matchAll(/\bawait\b[^;]*;/g)) {
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const set = tail.search(/\bsetState\s*\(/);
    const close = tail.search(/\n\s{0,2}\}/);
    if (set !== -1 && (close === -1 || set < close) && !/mounted/.test(tail.slice(0, set))) out.push({ index: m.index + m[0].length + set });
  }
  return out;
}

export const rules = [
  // ---------- iOS / Swift ----------
  {
    id: "SWIFT_FORCE_TRY",
    severity: "ERROR",
    files: SWIFT,
    exclude: TEST_FILE,
    regex: /\btry!/,
    message: "`try!` crashes the app on any thrown error. Use do/catch or `try?` with a fallback.",
    examples: [{ file: "A.swift", bad: ["let data = try! Data(contentsOf: url)"], good: ["let data = try Data(contentsOf: url)"] }],
  },
  {
    id: "SWIFT_FORCE_CAST",
    severity: "ERROR",
    files: SWIFT,
    exclude: TEST_FILE,
    regex: /\bas!/,
    message: "`as!` crashes when the cast fails. Use `as?` with guard/if-let.",
    examples: [{ file: "A.swift", bad: ["let cell = tableView.dequeueReusableCell(withIdentifier: id) as! Cell"], good: ["guard let cell = view as? Cell else { return }"] }],
  },
  {
    id: "SWIFT_FORCE_UNWRAP",
    severity: "WARN",
    files: SWIFT,
    exclude: TEST_FILE,
    check: swiftForceUnwrap,
    message: "Force unwrap `!` crashes on nil. Use guard let / if let / ?? default.",
    examples: [{ file: "A.swift", bad: ["let url = URL(string: s)!", "user!.name"], good: ["@IBOutlet weak var label: UILabel!", "if a != b {}", "Text(\"Welcome back! Let's go\")", "guard let url = URL(string: s) else { return }", "if !isLoading {}"] }],
  },
  {
    id: "SWIFT_MAIN_SYNC",
    severity: "ERROR",
    files: SWIFT,
    regex: /DispatchQueue\.main\.sync\b/,
    message: "DispatchQueue.main.sync deadlocks when called from the main thread. Use @MainActor / await MainActor.run / main.async.",
    examples: [{ file: "A.swift", bad: ["DispatchQueue.main.sync { self.update() }"], good: ["await MainActor.run { update() }"] }],
  },
  {
    id: "SWIFT_FIXED_FONT_SIZE",
    severity: "WARN",
    files: SWIFT,
    regex: /\.font\(\s*\.system\(\s*size:\s*\d+(?![^)]*relativeTo)|UIFont\.systemFont\(ofSize:/,
    message: "Fixed font size ignores Dynamic Type. Use text styles (.font(.body)) or scale with relativeTo / UIFontMetrics.",
    examples: [{ file: "A.swift", bad: ["Text(title).font(.system(size: 17))", "label.font = UIFont.systemFont(ofSize: 14)"], good: ["Text(title).font(.headline)", "label.font = UIFont.preferredFont(forTextStyle: .body)"] }],
  },
  {
    id: "SWIFT_DEVICE_SIZE_HARDCODE",
    severity: "ERROR",
    files: SWIFT,
    regex: /\.frame\(\s*width:\s*(?:320|375|390|393|402|414|428|430|440)\b|UIScreen\.main\.bounds/,
    message: "Layout hardcoded to one device width (or UIScreen.main, deprecated for multi-window). Use flexible frames, GeometryReader or containerRelativeFrame.",
    examples: [{ file: "A.swift", bad: [".frame(width: 375, height: 200)", "let w = UIScreen.main.bounds.width"], good: [".frame(maxWidth: .infinity)"] }],
  },
  {
    id: "SWIFT_ICON_BUTTON_UNLABELLED",
    severity: "ERROR",
    files: SWIFT,
    check: swiftImageButtonUnlabelled,
    message: "Icon-only Button without an accessibility label: VoiceOver reads the SF Symbol name. Use Label(\"Delete\", systemImage:) or .accessibilityLabel.",
    examples: [{ file: "A.swift", bad: ["Button(action: delete) { Image(systemName: \"trash\") }"], good: ["Button(action: delete) { Image(systemName: \"trash\") }\n  .accessibilityLabel(\"Delete\")", "Button(action: delete) { Label(\"Delete\", systemImage: \"trash\") }"] }],
  },
  {
    id: "SWIFTUI_ONAPPEAR_TASK",
    severity: "WARN",
    files: SWIFT,
    regex: /\.onAppear\s*\{\s*Task\s*\{/,
    message: ".onAppear { Task { } } leaks work after the view disappears. Use .task { }, which is cancelled automatically.",
    examples: [{ file: "A.swift", bad: [".onAppear { Task { await vm.load() } }"], good: [".task { await vm.load() }"] }],
  },
  {
    id: "SWIFT_ANYVIEW",
    severity: "WARN",
    files: SWIFT,
    regex: /\bAnyView\s*\(/,
    message: "AnyView erases identity and defeats SwiftUI diffing. Use @ViewBuilder, generics or `some View`.",
    examples: [{ file: "A.swift", bad: ["return AnyView(Text(\"x\"))"], good: ["@ViewBuilder var body: some View { Text(\"x\") }"] }],
  },
  {
    id: "SWIFT_PRINT_LOGGING",
    severity: "WARN",
    files: SWIFT,
    exclude: TEST_FILE,
    regex: /^[ \t]*(?:print|debugPrint|NSLog)\(/m,
    message: "print() logging ships to production and cannot be filtered. Use os.Logger with a subsystem/category.",
    examples: [{ file: "A.swift", bad: ["    print(\"loaded\", items)"], good: ["    logger.debug(\"loaded \\(items.count)\")"] }],
  },
  // ---------- Android / Kotlin ----------
  {
    id: "KOTLIN_GLOBALSCOPE",
    severity: "ERROR",
    files: KT,
    regex: /\bGlobalScope\.(?:launch|async)\b/,
    message: "GlobalScope coroutines outlive the screen and leak. Use viewModelScope / lifecycleScope / an injected scope.",
    examples: [{ file: "A.kt", bad: ["GlobalScope.launch { repo.sync() }"], good: ["viewModelScope.launch { repo.sync() }"] }],
  },
  {
    id: "BLOCKING_SLEEP",
    severity: "ERROR",
    files: ANDROID_SRC,
    exclude: TEST_FILE,
    regex: /\bThread\.sleep\s*\(|\brunBlocking\s*[{(]/,
    message: "Thread.sleep/runBlocking blocks the calling thread (ANR on main). Use delay() inside a coroutine.",
    examples: [{ file: "A.kt", bad: ["Thread.sleep(500)", "val u = runBlocking { api.user() }"], good: ["delay(500)"] }],
  },
  {
    id: "KOTLIN_NOT_NULL_ASSERTION",
    severity: "WARN",
    files: KT,
    exclude: TEST_FILE,
    regex: /\w[)\]]?!!/,
    message: "`!!` throws NullPointerException. Use ?.let, ?: or requireNotNull with a message.",
    examples: [{ file: "A.kt", bad: ["val id = intent.extras!!.getString(\"id\")"], good: ["val id = intent.extras?.getString(\"id\") ?: return"] }],
  },
  {
    id: "COMPOSE_ICON_BUTTON_NULL_DESCRIPTION",
    severity: "ERROR",
    files: KT,
    regex: /IconButton\s*\([\s\S]{0,240}?contentDescription\s*=\s*null/,
    message: "IconButton whose icon has contentDescription = null is unlabeled for TalkBack. Describe the action.",
    examples: [{ file: "A.kt", bad: ["IconButton(onClick = onClose) {\n    Icon(Icons.Default.Close, contentDescription = null)\n}"], good: ["IconButton(onClick = onClose) {\n    Icon(Icons.Default.Close, contentDescription = stringResource(R.string.close))\n}"] }],
  },
  {
    id: "COMPOSE_STATE_WITHOUT_REMEMBER",
    severity: "ERROR",
    files: KT,
    check: (src) => (/@Composable/.test(src) && !/ViewModel\b/.test(src) ? [...src.matchAll(/^[ \t]*(?:val|var)\s+\w+\s*(?:=|by)\s*mutableStateOf\(/gm)].map((m) => ({ index: m.index })) : []),
    message: "mutableStateOf without remember resets on every recomposition. Wrap in remember { } (or rememberSaveable).",
    examples: [{ file: "A.kt", bad: ["@Composable\nfun C() {\n    var open by mutableStateOf(false)\n}"], good: ["@Composable\nfun C() {\n    var open by remember { mutableStateOf(false) }\n}"] }],
  },
  {
    id: "COMPOSE_HARDCODED_STRING",
    severity: "WARN",
    files: KT,
    exclude: TEST_FILE,
    regex: /\bText\(\s*(?:text\s*=\s*)?"[^"$]{3,}"/,
    message: "Hardcoded UI string can't be translated. Use stringResource(R.string.x).",
    examples: [{ file: "A.kt", bad: ["Text(\"Welcome back\")"], good: ["Text(stringResource(R.string.welcome))"] }],
  },
  {
    id: "ANDROID_LOG_DEBUG",
    severity: "WARN",
    files: ANDROID_SRC,
    exclude: TEST_FILE,
    regex: /\bLog\.[dv]\(|^[ \t]*println\(|System\.out\.println\(/m,
    message: "Debug logging ships in release builds. Use Timber with a release tree, or strip with R8 rules.",
    examples: [{ file: "A.kt", bad: ["Log.d(TAG, \"user=$user\")"], good: ["Timber.d(\"loaded\")"] }],
  },
  // ---------- Manifests ----------
  {
    id: "ANDROID_CLEARTEXT_TRAFFIC",
    severity: "ERROR",
    files: /\.xml$/,
    regex: /android:usesCleartextTraffic\s*=\s*"true"|<base-config[^>]*cleartextTrafficPermitted\s*=\s*"true"/,
    message: "Cleartext HTTP enabled app-wide. Use HTTPS; scope exceptions to specific debug domains in network_security_config.",
    examples: [{ file: "AndroidManifest.xml", bad: ['<application android:usesCleartextTraffic="true">'], good: ['<application android:networkSecurityConfig="@xml/network_security_config">'] }],
  },
  {
    id: "ANDROID_DEBUGGABLE",
    severity: "ERROR",
    files: /AndroidManifest\.xml$/,
    regex: /android:debuggable\s*=\s*"true"/,
    message: "android:debuggable hardcoded in the manifest ships debuggable release builds. Let the build type set it.",
    examples: [{ file: "AndroidManifest.xml", bad: ['<application android:debuggable="true">'], good: ["<application>"] }],
  },
  {
    id: "ANDROID_ALLOW_BACKUP",
    severity: "WARN",
    files: /AndroidManifest\.xml$/,
    regex: /android:allowBackup\s*=\s*"true"(?![\s\S]*android:(?:fullBackupContent|dataExtractionRules))/,
    message: "allowBackup without backup rules copies tokens and databases to cloud/adb backups. Add dataExtractionRules or disable.",
    examples: [{ file: "AndroidManifest.xml", bad: ['<application android:allowBackup="true">'], good: ['<application android:allowBackup="true" android:dataExtractionRules="@xml/rules">'] }],
  },
  {
    id: "IOS_ATS_ARBITRARY_LOADS",
    severity: "ERROR",
    files: /\.plist$/,
    regex: /<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/,
    message: "App Transport Security disabled for all domains (App Review asks for justification). Use HTTPS or a per-domain NSExceptionDomains entry.",
    examples: [{ file: "Info.plist", bad: ["<key>NSAllowsArbitraryLoads</key>\n<true/>"], good: ["<key>NSAllowsArbitraryLoads</key>\n<false/>"] }],
  },
  {
    id: "IOS_VAGUE_PURPOSE_STRING",
    severity: "ERROR",
    files: /\.plist$/,
    regex: /<key>NS\w+UsageDescription<\/key>\s*<string>\s*(?:[^<]{0,24}|[^<]*(?:TODO|needs access|requires access|for the app)[^<]*)<\/string>/i,
    message: "Empty or vague permission purpose string: App Review rejects these (guideline 5.1.1). Say what the feature does with the data.",
    examples: [{ file: "Info.plist", bad: ["<key>NSCameraUsageDescription</key>\n<string>Camera access</string>", "<key>NSLocationWhenInUseUsageDescription</key><string>This app needs access to your location.</string>"], good: ["<key>NSCameraUsageDescription</key>\n<string>Scan receipts to add expenses without typing them in.</string>"] }],
  },
  // ---------- Cross-platform secrets ----------
  {
    id: "INSECURE_TOKEN_STORAGE",
    severity: "ERROR",
    regex: /UserDefaults[^\n]*\.set\([^\n]*(?:token|password|secret|jwt)|forKey:\s*"[^"]*(?:token|password|secret)[^"]*"\)(?![^\n]*Keychain)|putString\(\s*"[^"]*(?:token|password|secret)|AsyncStorage\.setItem\(\s*["'`][^"'`]*(?:token|password|secret)|SharedPreferences[^\n]*setString\(\s*['"][^'"]*(?:token|password|secret)/i,
    message: "Credential stored in plain preferences (UserDefaults/SharedPreferences/AsyncStorage). Use Keychain, EncryptedSharedPreferences/Keystore, expo-secure-store or flutter_secure_storage.",
    examples: [
      { file: "A.swift", bad: ['UserDefaults.standard.set(token, forKey: "authToken")'], good: ['try keychain.set(token, key: "authToken")'] },
      { file: "A.kt", bad: ['prefs.edit().putString("access_token", token).apply()'], good: ['securePrefs.edit().putString("theme", theme).apply()'] },
      { file: "a.tsx", bad: ["await AsyncStorage.setItem('token', jwt)"], good: ["await SecureStore.setItemAsync('token', jwt)"] },
    ],
  },
  // ---------- React Native ----------
  {
    id: "RN_SCROLLVIEW_MAP",
    severity: "WARN",
    files: JSX,
    regex: /<ScrollView\b[^>]*>\s*\{\s*[\w.?]+\.map\(/,
    message: "ScrollView + .map renders every row at once. Use FlatList/FlashList for lists.",
    examples: [{ file: "a.tsx", bad: ["<ScrollView>\n  {items.map((i) => <Row key={i.id} />)}"], good: ["<FlatList data={items} renderItem={renderRow} keyExtractor={(i) => i.id} />"] }],
  },
  {
    id: "RN_TOUCHABLE_UNLABELLED",
    severity: "WARN",
    files: JSX,
    regex: /<(?:TouchableOpacity|TouchableHighlight|Pressable)\b(?![^>]*accessibilityLabel)(?![^>]*accessibilityRole)[^>]*>\s*<(?:Icon|Image|Ionicons|MaterialIcons|Feather)\b/,
    message: "Icon-only touchable without accessibilityLabel/accessibilityRole is invisible to screen readers.",
    examples: [{ file: "a.tsx", bad: ["<Pressable onPress={close}>\n  <Ionicons name=\"close\" />"], good: ["<Pressable accessibilityRole=\"button\" accessibilityLabel=\"Close\" onPress={close}>\n  <Ionicons name=\"close\" />"] }],
  },
  // ---------- Flutter ----------
  {
    id: "FLUTTER_SETSTATE_AFTER_AWAIT",
    severity: "WARN",
    files: DART,
    check: flutterSetStateAfterAwait,
    message: "setState after an await without a `mounted` check throws if the widget was disposed. Add `if (!mounted) return;`.",
    examples: [{ file: "a.dart", bad: ["Future<void> load() async {\n  final d = await api.get();\n  setState(() => data = d);\n}"], good: ["Future<void> load() async {\n  final d = await api.get();\n  if (!mounted) return;\n  setState(() => data = d);\n}"] }],
  },
  {
    id: "FLUTTER_PRINT",
    severity: "WARN",
    files: DART,
    exclude: TEST_FILE,
    regex: /^[ \t]*print\(/m,
    message: "print() ships to release logs. Use debugPrint or package:logging.",
    examples: [{ file: "a.dart", bad: ["  print('user $user');"], good: ["  log.fine('user loaded');"] }],
  },
];
