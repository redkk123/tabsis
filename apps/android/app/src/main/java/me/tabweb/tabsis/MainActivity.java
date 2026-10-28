package me.tabweb.tabsis;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

/**
 * O TabSis inteiro roda aqui dentro: é o mesmo site do tabweb.me, empacotado no
 * APK (assets/site) e servido pelo WebViewAssetLoader num endereço https que
 * nunca sai do aparelho (https://app.tabweb.me). Os microdados abertos não vão
 * para lugar nenhum; só a busca no DATASUS e no IBGE usa a internet.
 */
public class MainActivity extends ComponentActivity {

    /** Domínio interceptado localmente; nenhuma requisição a ele chega à rede. */
    static final String DOMINIO = "app.tabweb.me";
    static final String INICIO = "https://" + DOMINIO + "/site/index.html";

    private WebView webView;
    /** Sobrevive a recomeçar a tela: os downloads em andamento continuam e o site os acha de novo. */
    private static LocalAndroid local;
    private ValueCallback<Uri[]> escolhaPendente;
    private ActivityResultLauncher<Intent> escolherArquivos;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        // O WebView ignora padding (desenha a página por baixo dele): quem
        // recebe o espaço das barras do sistema é este contêiner, pintado com o
        // azul do topo do TabSis. Sem isso, relógio e ícones ficavam em cima
        // do cabeçalho do site (print do Red, 2026-10-27).
        FrameLayout moldura = new FrameLayout(this);
        moldura.setBackgroundColor(getColor(R.color.tabsis_azul));
        moldura.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(moldura);

        // Android 15 desenha de ponta a ponta: as barras do sistema não podem cobrir o site.
        ViewCompat.setOnApplyWindowInsetsListener(moldura, (view, insets) -> {
            Insets barras = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(barras.left, barras.top, barras.right, barras.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        // Ícones claros na barra de status e na de navegação, sobre o azul.
        WindowInsetsControllerCompat barrasDoSistema = WindowCompat.getInsetsController(getWindow(), moldura);
        barrasDoSistema.setAppearanceLightStatusBars(false);
        barrasDoSistema.setAppearanceLightNavigationBars(false);

        WebSettings ajustes = webView.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setDatabaseEnabled(true);
        // Nada de file:// nem content:// direto: tudo passa pelo carregador de assets.
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        ajustes.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ajustes.setMediaPlaybackRequiresUserGesture(true);
        ajustes.setSupportMultipleWindows(false);
        ajustes.setUserAgentString(ajustes.getUserAgentString() + " TabSisAndroid/" + versao());

        WebViewAssetLoader carregador = new WebViewAssetLoader.Builder()
                .setDomain(DOMINIO)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri endereco = request.getUrl();
                // Um arquivo de Downloads/TabSis que o site pediu ao TabSis Local do app.
                if (DOMINIO.equals(endereco.getHost()) && "/__local/arquivo".equals(endereco.getPath())) {
                    return arquivoLocal(endereco);
                }
                return carregador.shouldInterceptRequest(endereco);
            }

            // Um arquivo grande demais pode esgotar a memória do processo que
            // desenha a página. Sem isto o app inteiro fecharia: aqui ele
            // recomeça a tela e avisa. Os downloads guardados continuam no aparelho.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Toast.makeText(MainActivity.this, detail.didCrash()
                        ? "O TabSis encontrou um erro e recomeçou a página."
                        : "Faltou memória para esta tabela; o TabSis recomeçou a página. Tente um arquivo menor ou feche outros apps.",
                        Toast.LENGTH_LONG).show();
                ViewGroup pai = (ViewGroup) view.getParent();
                if (pai != null) pai.removeView(view);
                view.destroy();
                if (view == webView) webView = null;
                recreate();
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri destino = request.getUrl();
                if (DOMINIO.equals(destino.getHost())) return false;
                // Link para fora (DATASUS, manual on-line, GitHub): abre no navegador.
                abrirFora(destino);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (escolhaPendente != null) escolhaPendente.onReceiveValue(null);
                escolhaPendente = callback;
                // O site pede extensões (.dbc, .dbf, .def…), que o Android não
                // traduz em tipo: oferece tudo e o site confere o arquivo.
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    escolherArquivos.launch(intent);
                } catch (ActivityNotFoundException e) {
                    escolhaPendente = null;
                    return false;
                }
                return true;
            }
        });

        escolherArquivos = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), resultado -> {
            if (escolhaPendente == null) return;
            Uri[] escolhidos = null;
            Intent dados = resultado.getData();
            if (resultado.getResultCode() == RESULT_OK && dados != null) {
                ClipData varios = dados.getClipData();
                if (varios != null) {
                    escolhidos = new Uri[varios.getItemCount()];
                    for (int i = 0; i < varios.getItemCount(); i++) escolhidos[i] = varios.getItemAt(i).getUri();
                } else if (dados.getData() != null) {
                    escolhidos = new Uri[] { dados.getData() };
                }
            }
            escolhaPendente.onReceiveValue(escolhidos);
            escolhaPendente = null;
        });

        if (local == null) local = new LocalAndroid(this);
        webView.addJavascriptInterface(new PonteAndroid(this, local), "TabSisAndroid");

        // Voltar: fecha a janela aberta no site (busca, manual…); senão, volta a página; senão, sai.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                        "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",
                        fechou -> {
                            if ("true".equals(fechou)) return;
                            if (webView.canGoBack()) webView.goBack();
                            else finish();
                        });
            }
        });

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(INICIO);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    private WebResourceResponse arquivoLocal(Uri endereco) {
        java.util.Map<String, String> cabecalhos = new java.util.HashMap<>();
        cabecalhos.put("Cache-Control", "no-store");
        try {
            String nome = endereco.getQueryParameter("nome");
            String pasta = endereco.getQueryParameter("pasta");
            java.io.InputStream entrada = local.abrir(nome == null ? "" : nome, pasta == null ? "principal" : pasta);
            return new WebResourceResponse("application/octet-stream", null, 200, "OK", cabecalhos, entrada);
        } catch (Exception e) {
            String erro = "{\"error\":" + org.json.JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            return new WebResourceResponse("application/json", "utf-8", 404, "Not Found", cabecalhos,
                    new java.io.ByteArrayInputStream(erro.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
    }

    String versao() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    void abrirFora(Uri destino) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, destino));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nenhum aplicativo abre " + destino, Toast.LENGTH_LONG).show();
        }
    }

    /** O "Imprimir" do site: a página atual vai para o serviço de impressão (ou PDF). */
    void imprimir() {
        runOnUiThread(() -> {
            PrintManager impressao = (PrintManager) getSystemService(PRINT_SERVICE);
            impressao.print("TabSis", webView.createPrintDocumentAdapter("TabSis"), new PrintAttributes.Builder().build());
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
