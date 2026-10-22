plugins { id("com.android.library"); id("org.jetbrains.kotlin.android") }

android {
    namespace = "household.share.android"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].java.srcDir("../../app/src/main/java")
    sourceSets["main"].res.srcDir("../../app/src/main/res")
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webAssets"))
}

val bundleWeb by tasks.registering(Sync::class) {
    from("../../../../web/dist") { into("web") }
    into(layout.buildDirectory.dir("webAssets"))
    doFirst { require(file("../../../../web/dist/index.html").isFile) { "Build shared web/dist first" } }
}
tasks.named("preBuild").configure { dependsOn(bundleWeb) }
dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
}
