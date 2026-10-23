plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "household.share.android"
    compileSdk = 36
    defaultConfig {
        applicationId = "household.share.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 5
        versionName = "0.1.4"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webAssets"))
}

val bundleWeb by tasks.registering(Sync::class) {
    from("../../../web/dist") { into("web") }
    into(layout.buildDirectory.dir("webAssets"))
    doFirst {
        require(file("../../../web/dist/index.html").isFile) {
            "Build shared UI first: pnpm --dir web build (web/dist/index.html missing)"
        }
    }
}
tasks.named("preBuild").configure { dependsOn(bundleWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20180813")
}
