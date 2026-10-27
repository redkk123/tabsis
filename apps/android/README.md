# TabSis para Android

O app é o próprio TabSis (o site de `apps/web`) empacotado no APK e aberto num
WebView. O site é servido pelo `WebViewAssetLoader` no endereço
`https://app.tabweb.me/site/`, que é interceptado no aparelho e nunca chega à
rede. Os microdados abertos ficam no celular, como no navegador. Só a busca no
DATASUS (pelo proxy) e a população do IBGE usam a internet.

O que o WebView não faz sozinho, o app faz:

- **Abrir arquivos** (DBC, DBF, DEF, CNV, CSV…): seletor do Android, com vários
  arquivos de uma vez.
- **Salvar** (CSV, XLSX, .tab, PNG, .zip, DBC guardado): o WebView não baixa
  `blob:`. O site manda o arquivo em pedaços para a `PonteAndroid`, que o grava
  em `Downloads/TabSis`, sem pedir permissão de armazenamento.
- **PDF da documentação oficial:** vai para Downloads e abre no leitor de PDF.
- **Imprimir:** serviço de impressão do Android (inclui "Salvar como PDF").
- **Falta de memória:** se o processo que desenha a página cair (arquivo grande
  demais), o app recomeça a tela e avisa, em vez de fechar.
- **Voltar:** fecha a janela aberta no site (busca no DATASUS, manual); senão,
  volta a página; senão, sai do app.
- **Links para fora** (DATASUS, GitHub) abrem no navegador.

## Construir

1. Na raiz do repositório, construa o site e copie para dentro do app:
   `npm run android:site`. Isso gera `app/src/main/assets/site`, que fica fora
   do git.
2. Abra `apps/android` no Android Studio e use **Run**, ou rode
   `./gradlew assembleDebug` nesta pasta (com `JAVA_HOME` num JDK 17+). O APK sai em
   `app/build/outputs/apk/debug/`.

O wrapper do Gradle (`gradlew`) está fixado em 9.8.2 (`gradle/wrapper/gradle-wrapper.properties`,
com SHA-256). Versões usadas: AGP 9.4.1, compileSdk/targetSdk 36, minSdk 29
(Android 10), AndroidX core 1.18.0, activity 1.13.0 e webkit 1.18.0.

## Testar

Esta máquina não tem virtualização (`/dev/kvm`), então o emulador não roda.
Teste num celular com **Depuração USB** ou **Depuração por Wi-Fi** ligada nas
opções de desenvolvedor.

No site, `e2e/app.spec.ts` simula a ponte nativa (teste "dentro do app
Android…") e confere que salvar e imprimir passam por ela.

## Proxy

O proxy do DATASUS aceita a origem `https://app.tabweb.me`
(`apps/datasus-proxy/wrangler.jsonc`), que é a do app.
