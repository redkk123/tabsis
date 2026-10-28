package me.tabweb.tabsis;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * O que o WebView não faz sozinho e o site pede: salvar um arquivo gerado no
 * navegador (CSV, .tab, PNG, .zip, DBC guardado) e imprimir.
 *
 * O WebView não baixa `blob:`; o site manda o arquivo em pedaços (base64) por
 * aqui, e ele vai para Downloads/TabSis pelo MediaStore — sem permissão de
 * armazenamento, que o Android 10+ não exige para isso. Só a página do próprio
 * app enxerga esta ponte: links para fora abrem no navegador (MainActivity).
 */
final class PonteAndroid {
    private static final long MAXIMO = 1024L * 1024 * 1024;  // 1 GB, o mesmo teto do site

    private final MainActivity atividade;
    private final File pasta;
    private final LocalAndroid local;

    PonteAndroid(MainActivity atividade, LocalAndroid local) {
        this.atividade = atividade;
        this.pasta = new File(atividade.getCacheDir(), "salvando");
        this.local = local;
    }

    private File temporario(String id) {
        if (!id.matches("[0-9a-f-]{36}")) throw new IllegalArgumentException("id inválido");
        return new File(pasta, id);
    }

    /** Começa um arquivo; devolve o identificador usado nos pedaços. */
    @JavascriptInterface
    public String iniciarArquivo() {
        if (!pasta.exists() && !pasta.mkdirs()) throw new IllegalStateException("sem espaço temporário");
        String id = UUID.randomUUID().toString();
        try {
            if (!temporario(id).createNewFile()) throw new IllegalStateException("arquivo temporário já existe");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return id;
    }

    @JavascriptInterface
    public void escreverParte(String id, String base64) throws IOException {
        File destino = temporario(id);
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (destino.length() + bytes.length > MAXIMO) throw new IOException("arquivo maior que 1 GB");
        try (OutputStream saida = new FileOutputStream(destino, true)) {
            saida.write(bytes);
        }
    }

    /**
     * Termina e guarda em Downloads/TabSis. Com `abrir`, oferece o arquivo a um
     * aplicativo que o abra (o PDF da documentação oficial, por exemplo).
     * Devolve a frase que o site mostra.
     */
    @JavascriptInterface
    public String concluirArquivo(String id, String nome, String tipo, boolean abrir) {
        File origem = temporario(id);
        String limpo = nome.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (limpo.isEmpty()) limpo = "tabsis";
        String mime = tipo == null || tipo.isEmpty() ? "application/octet-stream" : tipo.split(";")[0].trim();
        ContentResolver resolver = atividade.getContentResolver();
        ContentValues valores = new ContentValues();
        valores.put(MediaStore.Downloads.DISPLAY_NAME, limpo);
        valores.put(MediaStore.Downloads.MIME_TYPE, mime);
        valores.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TabSis");
        valores.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores);
        if (uri == null) throw new IllegalStateException("o Android não criou o arquivo em Downloads");
        try (InputStream entrada = new FileInputStream(origem); OutputStream saida = resolver.openOutputStream(uri)) {
            if (saida == null) throw new IOException("sem acesso a Downloads");
            byte[] buffer = new byte[64 * 1024];
            for (int lidos; (lidos = entrada.read(buffer)) > 0; ) saida.write(buffer, 0, lidos);
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw new IllegalStateException("não deu para salvar " + limpo + ": " + e.getMessage());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            origem.delete();
        }
        valores.clear();
        valores.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, valores, null, null);

        if (abrir) {
            atividade.runOnUiThread(() -> {
                Intent ver = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    atividade.startActivity(ver);
                } catch (ActivityNotFoundException e) {
                    Toast.makeText(atividade, "Salvo em Downloads/TabSis, mas nenhum aplicativo abre " + mime, Toast.LENGTH_LONG).show();
                }
            });
        }
        return limpo + " salvo em Downloads/TabSis";
    }

    @JavascriptInterface
    public void descartarArquivo(String id) {
        //noinspection ResultOfMethodCallIgnored
        temporario(id).delete();
    }

    // ---- TabSis Local dentro do app (ver LocalAndroid): o mesmo protocolo do
    // app de computador, pela ponte em vez de HTTP.

    /** O /health do protocolo. */
    @JavascriptInterface
    public String localSaude() {
        try {
            return local.saude(atividade.versao());
        } catch (Exception e) {
            return "{}";
        }
    }

    /** As rotas de texto do protocolo; devolve {"status": código, "corpo": JSON}. */
    @JavascriptInterface
    public String localPedido(String metodo, String rota, String corpo) {
        if ("POST".equals(metodo) && "/downloads".equals(rota)) atividade.pedirNotificacaoSePreciso();
        return local.pedido(metodo, rota, corpo);
    }

    /**
     * Um guardado do navegador, montado em pedaços por iniciarArquivo /
     * escreverParte, vai para Downloads/TabSis/Guardados do navegador.
     */
    @JavascriptInterface
    public String localGuardado(String id, String nome) {
        File origem = temporario(id);
        try {
            return "{\"status\":201,\"corpo\":" + org.json.JSONObject.quote(local.guardar(origem, nome)) + "}";
        } catch (Exception e) {
            try {
                return new org.json.JSONObject().put("status", 400).put("corpo", new org.json.JSONObject().put("error", String.valueOf(e.getMessage())).toString()).toString();
            } catch (org.json.JSONException impossivel) {
                return "{\"status\":400,\"corpo\":\"{}\"}";
            }
        } finally {
            //noinspection ResultOfMethodCallIgnored
            origem.delete();
        }
    }

    @JavascriptInterface
    public void imprimir() {
        atividade.imprimir();
    }
}
