import com.android.build.api.artifact.SingleArtifact

// The locked shell (issue #627). No signing config: debug builds use Gradle's default debug key and
// release builds are unsigned; signing is the owner's (AGENTS.md section 1).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * The backend the app calls, fixed in the build (ADR 0011 §3): `-Pclassbeat.backendOrigin=…`. A
 * release takes only an HTTPS origin and has none by default, so it pairs with nothing until one
 * is given; a debug build defaults to loopback. Anything else fails the build. OriginPolicy checks
 * the value again at run time.
 */
fun backendOrigin(debug: Boolean): String {
    val given = providers.gradleProperty("classbeat.backendOrigin").orNull?.trim()
    val value = given ?: if (debug) "http://127.0.0.1:8000" else ""
    val https = Regex("^https://[a-z0-9-]+(\\.[a-z0-9-]+)*(:[1-9][0-9]{0,4})?$")
    val loopback = Regex("^http://(127\\.0\\.0\\.1|localhost)(:[1-9][0-9]{0,4})?$")
    require(value.isEmpty() || https.matches(value) || (debug && loopback.matches(value))) {
        "classbeat.backendOrigin must be an https origin (or loopback http in a debug build)"
    }
    return value
}

android {
    namespace = "org.classbeat.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.classbeat.player"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.0"
    }

    buildTypes {
        debug {
            isDebuggable = true
            buildConfigField("String", "BACKEND_ORIGIN", "\"${backendOrigin(debug = true)}\"")
        }
        release {
            isDebuggable = false
            buildConfigField("String", "BACKEND_ORIGIN", "\"${backendOrigin(debug = false)}\"")
            // Off: the lockdown reads Capacitor's plugin table by its field name (BridgeLockdown.kt).
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(project(":capacitor-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    // The Cordova plugin manager Capacitor runs; the lockdown empties it (BridgeLockdown.kt). The same
    // version Capacitor 8.6.0 pins (CorePluginsTest checks it).
    implementation("org.apache.cordova:framework:14.0.1")
    testImplementation("junit:junit:4.13.2")
}

// The pinned Capacitor package, read by the plugin allowlist test (CorePluginsTest.kt).
val capacitorPackage = rootProject.file("../node_modules/@capacitor/android")

androidComponents {
    onVariants { variant ->
        val cap = variant.name.replaceFirstChar { it.uppercase() }
        val manifest = variant.artifacts.get(SingleArtifact.MERGED_MANIFEST)
        // Each variant's JVM tests read that variant's merged manifest (ManifestTest.kt).
        tasks.matching { it.name == "test${cap}UnitTest" }.configureEach {
            val test = this as Test
            test.inputs.file(manifest)
            // The sources the test reads, not the whole package: Capacitor builds inside it.
            test.inputs.file(capacitorPackage.resolve("package.json"))
            test.inputs.file(capacitorPackage.resolve("capacitor/build.gradle"))
            test.inputs.dir(capacitorPackage.resolve("capacitor/src/main/java"))
            test.jvmArgumentProviders.add(
                CommandLineArgumentProvider {
                    listOf(
                        "-Dclassbeat.mergedManifest=${manifest.get().asFile.absolutePath}",
                        "-Dclassbeat.variant=${variant.name}",
                        "-Dclassbeat.capacitorPackage=${capacitorPackage.absolutePath}",
                    )
                },
            )
        }
    }
}

// The bundled page must be there before the app is packaged; `npm run build` in player/mobile makes it.
val bundledPage = file("src/main/assets/public/index.html")
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    doFirst {
        require(bundledPage.isFile) { "Build the page first: cd player/mobile && npm ci && npm run build" }
    }
}
