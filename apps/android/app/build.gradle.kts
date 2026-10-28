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
        versionCode = 10
        versionName = "1.0.8"
    }

    // Chave de release fora do repositório: caminho e senhas vêm do ambiente
    // (TABSIS_KEYSTORE, TABSIS_KEYSTORE_PASSWORD, TABSIS_KEY_ALIAS, TABSIS_KEY_PASSWORD).
    // A mesma chave sempre: sem ela, uma versão nova não instala por cima da antiga.
    val chave = providers.environmentVariable("TABSIS_KEYSTORE").orNull
    signingConfigs {
        if (chave != null) {
            create("release") {
                storeFile = file(chave)
                storePassword = providers.environmentVariable("TABSIS_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("TABSIS_KEY_ALIAS").getOrElse("tabsis")
                keyPassword = providers.environmentVariable("TABSIS_KEY_PASSWORD").orElse(providers.environmentVariable("TABSIS_KEYSTORE_PASSWORD")).get()
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (chave != null) signingConfig = signingConfigs.getByName("release")
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
