// Spike 3 (throwaway). `:core` is a plain JVM module and builds without the Android SDK.
// `:app` is the Android application; it is included only when an Android SDK is found
// (ANDROID_HOME, ANDROID_SDK_ROOT or sdk.dir in local.properties), so `./gradlew :core:test`
// works on a machine that has no SDK.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "android-follower"

include(":core")

val localProperties = java.util.Properties().apply {
    val f = file("local.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
val sdkDir = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT") ?: localProperties.getProperty("sdk.dir")
if (sdkDir != null && file(sdkDir).isDirectory) {
    include(":app")
} else {
    logger.warn("No Android SDK found: building :core only (the APK needs ANDROID_HOME or local.properties).")
}
