// The statements a spike build script may use to configure tasks, as exact texts (whitespace collapsed).
// Pure data for gradle_shape.ts. Everything else that configures a task is refused, so the merged-manifest
// check cannot be switched off, redirected or detached (review of #568, B1 and N1).

/** The CheckManifest task, body included: its allowed pattern cannot be widened without changing this text. */
export const CHECK_CLASS = "abstract class CheckManifest : DefaultTask() { @get:InputFile abstract val manifest: RegularFileProperty @TaskAction fun check() { val text = manifest.get().asFile.readText() val allowed = Regex(\"\"\"org\\.classbeat\\.spike\\.follower\\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION\"\"\") val asked = Regex(\"\"\"<uses-permission[^>]*?android:name=\"([^\"]+)\"\"\"\").findAll(text).map { it.groupValues[1] }.toList() val extra = asked.filterNot { allowed.matches(it) } if (extra.isNotEmpty()) throw GradleException(\"Merged manifest asks for permissions the spike must not have: $extra\") } }";

/** The one registration of the check, with its input fixed to the merged manifest. */
export const CHECK_REGISTER = "val check = tasks.register<CheckManifest>(\"verify${cap}ManifestPermissions\") { manifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST)) }";

/** Copies the scene demo into the assets. */
export const SYNC_SCENE = "val syncSceneAssets = tasks.register<Sync>(\"syncSceneAssets\") { from(sceneDist) into(layout.buildDirectory.dir(\"generated/scene-assets/scene\")) doFirst { require(sceneDist.resolve(\"index.html\").isFile) { \"Build the scene demo first: cd player/scene/render && npm ci && npm run build\" } } }";

export const MERGE_ASSETS_WIRING = "tasks.matching { it.name.startsWith(\"merge\") && it.name.endsWith(\"Assets\") }.configureEach { dependsOn(syncSceneAssets) }";

export const CORE_TEST = "tasks.test { useJUnitPlatform() }";

/** Script path -> statements it may use to configure tasks. */
export const PINNED: Record<string, string[]> = {
  "app/build.gradle.kts": [CHECK_CLASS, CHECK_REGISTER, SYNC_SCENE, MERGE_ASSETS_WIRING],
  "core/build.gradle.kts": [CORE_TEST],
};
