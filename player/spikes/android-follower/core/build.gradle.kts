// The pure parts of spike 3: reading-to-log-line mapping, Spotify package filter, frame-rate
// summary. Plain JVM Kotlin: no Android classes, no I/O, so the tests run without the Android SDK.
plugins {
    id("org.jetbrains.kotlin.jvm")
}

// Bytecode for Java 17 (what the Android module uses), built by whichever JDK 17 or newer runs Gradle.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
