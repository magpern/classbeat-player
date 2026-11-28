// The allowlists the iOS app is held to (issue #894, ADR 0016 sections 2, 3 and 8), shared by the
// Linux guards (test/ios-project.test.ts) and the macOS check of the built app (ios:verify), so the
// two read the same lists. Data only.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The Info.plist keys the app may have. NSFaceIDUsageDescription is for the sign-in to come (ADR 0016); UIAppFonts registers the bundled fonts the native pairing screens draw in (#988). */
export const INFO_KEYS = new Set([
  "CFBundleDevelopmentRegion",
  "CFBundleDisplayName",
  "CFBundleExecutable",
  "CFBundleIdentifier",
  "CFBundleInfoDictionaryVersion",
  "CFBundleName",
  "CFBundlePackageType",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "LSRequiresIPhoneOS",
  "NSFaceIDUsageDescription",
  "UIAppFonts",
  "UIApplicationSceneManifest",
  "UILaunchScreen",
  "UIRequiredDeviceCapabilities",
  "UISupportedInterfaceOrientations",
  "UISupportedInterfaceOrientations~ipad",
  "UIViewControllerBasedStatusBarAppearance",
]);
/** The font files UIAppFonts lists, in order: the three the native pairing screens draw in (#988), beside Info.plist. */
export const APP_FONTS: Json = ["big-shoulders-display-800.ttf", "atkinson-hyperlegible-400.ttf", "atkinson-hyperlegible-700.ttf"];
/** Keys that are never in the app, at any depth: camera, microphone, photos, location, background
 * modes, Bluetooth, arbitrary loads, other apps' links and the rest of what it does not do. */
export const BANNED_KEY =
  /^(NSCamera|NSMicrophone|NSPhotoLibrary|NSLocation|UIBackgroundModes|NSBluetooth|NSAllowsArbitraryLoads|NSAllowsLocalNetworking|NSSpeechRecognition|NSAppleMusic|NSLocalNetwork|NSBonjourServices|NSMotion|NSContacts|NSCalendars|NSReminders|NSHealth|NSUserTracking|NSNearbyInteraction|CFBundleURLTypes|LSApplicationQueriesSchemes|UIFileSharingEnabled|LSSupportsOpeningDocumentsInPlace|CFBundleDocumentTypes|NSUserActivityTypes|BGTaskSchedulerPermittedIdentifiers|com\.apple\.)/;
/** The keys Xcode adds to the Info.plist it builds: the toolchain, platform and SDK it used. */
export const BUILD_ADDED_KEYS = new Set(
  (
    "BuildMachineOSBuild CFBundleSupportedPlatforms DTCompiler DTPlatformBuild DTPlatformName DTPlatformVersion DTSDKBuild " +
    "DTSDKName DTXcode DTXcodeBuild MinimumOSVersion UIDeviceFamily"
  ).split(" "),
);
/** The one window scene, its delegate named through the module (the built plist has the module's name). */
export const scenes = (module = "$(PRODUCT_MODULE_NAME)"): Json => ({
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: `${module}.SceneDelegate` }],
  },
});
/** The one difference of the debug plist: plain http to localhost, for a loopback test server. */
export const DEBUG_ATS: Json = { NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true } } };

/** The build settings the project may set. Nothing that adds Info.plist keys (INFOPLIST_KEY_*,
 * INFOPLIST_PREPROCESS), entitlements, linker or compiler flags, or another plist. */
export const SETTING_KEYS = new Set(
  (
    "ALWAYS_SEARCH_USER_PATHS ASSETCATALOG_COMPILER_APPICON_NAME ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME BUNDLE_LOADER " +
    "CLANG_ANALYZER_NONNULL CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION CLANG_CXX_LANGUAGE_STANDARD CLANG_CXX_LIBRARY CLANG_ENABLE_MODULES " +
    "CLANG_ENABLE_OBJC_ARC CLANG_ENABLE_OBJC_WEAK CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING CLANG_WARN_BOOL_CONVERSION CLANG_WARN_COMMA " +
    "CLANG_WARN_CONSTANT_CONVERSION CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS CLANG_WARN_DIRECT_OBJC_ISA_USAGE " +
    "CLANG_WARN_DOCUMENTATION_COMMENTS CLANG_WARN_EMPTY_BODY CLANG_WARN_ENUM_CONVERSION CLANG_WARN_INFINITE_RECURSION " +
    "CLANG_WARN_INT_CONVERSION CLANG_WARN_NON_LITERAL_NULL_CONVERSION CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF " +
    "CLANG_WARN_OBJC_LITERAL_CONVERSION CLANG_WARN_OBJC_ROOT_CLASS CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER " +
    "CLANG_WARN_RANGE_LOOP_ANALYSIS CLANG_WARN_STRICT_PROTOTYPES CLANG_WARN_SUSPICIOUS_MOVE CLANG_WARN_UNGUARDED_AVAILABILITY " +
    "CLANG_WARN_UNREACHABLE_CODE CLANG_WARN__DUPLICATE_METHOD_MATCH CODE_SIGN_STYLE COPY_PHASE_STRIP CURRENT_PROJECT_VERSION " +
    "DEBUG_INFORMATION_FORMAT ENABLE_NS_ASSERTIONS ENABLE_STRICT_OBJC_MSGSEND ENABLE_TESTABILITY GCC_C_LANGUAGE_STANDARD " +
    "GCC_DYNAMIC_NO_PIC GCC_NO_COMMON_BLOCKS GCC_OPTIMIZATION_LEVEL GCC_PREPROCESSOR_DEFINITIONS GCC_WARN_64_TO_32_BIT_CONVERSION " +
    "GCC_WARN_ABOUT_RETURN_TYPE GCC_WARN_UNDECLARED_SELECTOR GCC_WARN_UNINITIALIZED_AUTOS GCC_WARN_UNUSED_FUNCTION " +
    "GCC_WARN_UNUSED_VARIABLE GENERATE_INFOPLIST_FILE INFOPLIST_FILE IPHONEOS_DEPLOYMENT_TARGET LD_RUNPATH_SEARCH_PATHS " +
    "MARKETING_VERSION MTL_ENABLE_DEBUG_INFO MTL_FAST_MATH ONLY_ACTIVE_ARCH PRODUCT_BUNDLE_IDENTIFIER PRODUCT_NAME SDKROOT " +
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS SWIFT_COMPILATION_MODE SWIFT_OPTIMIZATION_LEVEL SWIFT_VERSION TARGETED_DEVICE_FAMILY " +
    "TEST_HOST VALIDATE_PRODUCT"
  ).split(" "),
);
/** The object kinds the project may hold: no copy-files phase, build rule, package or reference proxy. */
export const OBJECT_KINDS = new Set([
  "PBXBuildFile", "PBXContainerItemProxy", "PBXFileReference", "PBXFrameworksBuildPhase", "PBXGroup", "PBXNativeTarget",
  "PBXProject", "PBXResourcesBuildPhase", "PBXShellScriptBuildPhase", "PBXSourcesBuildPhase", "PBXTargetDependency",
  "XCBuildConfiguration", "XCConfigurationList",
]);
/** The words the project never holds: entitlements, capabilities and Swift packages. */
export const BANNED_PROJECT_WORDS = ["CODE_SIGN_ENTITLEMENTS", "SystemCapabilities", "XCRemoteSwiftPackageReference", "XCLocalSwiftPackageReference", "XCSwiftPackageProductDependency"];

/** The entitlements a built app may carry: none of its own. Xcode's default identity (the app
 * identifier, the team, the app's own keychain group) and, in a debug build, a debugger. */
export const ENTITLEMENTS = new Set(["application-identifier", "com.apple.developer.team-identifier", "keychain-access-groups"]);
export const DEBUG_ENTITLEMENTS = new Set(["get-task-allow"]);
