import com.android.build.api.artifact.SingleArtifact

// Spike 3 app (throwaway). Debug-signed only: there is no signing config and no release build type.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/** Fails the build when the merged manifest asks for any permission beyond the one androidx adds itself. */
abstract class CheckManifest : DefaultTask() {
    @get:InputFile
    abstract val manifest: RegularFileProperty

    @TaskAction
    fun check() {
        val text = manifest.get().asFile.readText()
        val allowed = Regex("""org\.classbeat\.spike\.follower\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION""")
        val asked = Regex("""<uses-permission[^>]*?android:name="([^"]+)"""").findAll(text).map { it.groupValues[1] }.toList()
        val extra = asked.filterNot { allowed.matches(it) }
        if (extra.isNotEmpty()) throw GradleException("Merged manifest asks for permissions the spike must not have: $extra")
    }
}

android {
    namespace = "org.classbeat.spike.follower"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.classbeat.spike.follower"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.0.0-spike3"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/scene-assets"))
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
}

// The scene demo (player/scene/render) is bundled as it is built there: `npm ci && npm run build`.
val sceneDist = rootProject.file("../../scene/render/dist")
val syncSceneAssets = tasks.register<Sync>("syncSceneAssets") {
    from(sceneDist)
    into(layout.buildDirectory.dir("generated/scene-assets/scene"))
    doFirst {
        require(sceneDist.resolve("index.html").isFile) {
            "Build the scene demo first: cd player/scene/render && npm ci && npm run build"
        }
    }
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach { dependsOn(syncSceneAssets) }

androidComponents {
    onVariants { variant ->
        val cap = variant.name.replaceFirstChar { it.uppercase() }
        val check = tasks.register<CheckManifest>("check${cap}Manifest") {
            manifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
        }
        tasks.matching { it.name == "assemble$cap" }.configureEach { dependsOn(check) }
    }
}
