// The phone and tablet app (ADR 0011, issue #627): the locked Capacitor shell. `:app` is ours;
// `:capacitor-android` is Capacitor's Android library, built from its pinned npm package
// (../package.json: @capacitor/android 8.6.0), so `npm ci` in player/mobile comes first.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // Capacitor's library build file declares its own google() and mavenCentral(); the settings'
    // repositories win, so nothing else can be added from a project build file.
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "classbeat-mobile"

val capacitor = file("../node_modules/@capacitor/android/capacitor")
require(capacitor.resolve("build.gradle").isFile) {
    "Install the pinned Capacitor first: cd player/mobile && npm ci"
}

include(":app")
include(":capacitor-android")
project(":capacitor-android").projectDir = capacitor
