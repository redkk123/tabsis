plugins {
    id("com.android.application")
}

android {
    namespace = "me.tabweb.tabsis"
    compileSdk = 36
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "me.tabweb.tabsis"
        // Android 10: salvar em Downloads (MediaStore) sem pedir permissão de armazenamento.
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // O site (dist-web) entra como asset em src/main/assets/site, copiado por
    // `npm run android:site` na raiz do repositório.
    androidResources {
        noCompress += listOf("dbc", "parquet", "json", "map")
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.activity:activity:1.13.0")
    implementation("androidx.core:core:1.18.0")
}
