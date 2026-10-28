package me.tabweb.tabsis;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * O TabSis Local dentro do app: baixa do DATASUS direto para Downloads/TabSis,
 * um arquivo de cada vez e em segundo plano, e deixa o site listar e abrir o
 * que está lá. Fala o mesmo protocolo do TabSis Local de computador
 * (apps/desktop/tabsis_local.py, "tabwin-bridge" versão 1), só que pela ponte
 * do WebView em vez de HTTP: nenhuma porta é aberta no aparelho, e só a
 * página do próprio app enxerga isto.
 *
 * Endereços aceitos: os mesmos do app de computador (o FTP público e os
 * pacotes preparados do DATASUS). Nada mais.
 */
final class LocalAndroid {
    static final String VERSAO_PROTOCOLO = "1";
    private static final long MAXIMO = 1024L * 1024 * 1024;  // 1 GB, o mesmo teto do site
    private static final String FTP_HOST = "ftp.datasus.gov.br";
    private static final String FTP_RAIZ = "/dissemin/publicos/";
    static final String PASTA = Environment.DIRECTORY_DOWNLOADS + "/TabSis/";
    static final String PASTA_GUARDADOS = PASTA + "Guardados do navegador/";
    private static final Set<String> EXTENSOES = new HashSet<>(Arrays.asList(".dbc", ".dbf", ".parquet", ".csv", ".tsv", ".def", ".cnv", ".map", ".zip"));
    private static final Set<String> RESERVADOS = new HashSet<>(Arrays.asList("CON", "PRN", "AUX", "NUL"));

    /** Um pedido recusado pela política (endereço, nome, tamanho). */
    static final class Recusado extends Exception {
        Recusado(String motivo) { super(motivo); }
    }

    private static final class Tarefa {
        final String id = UUID.randomUUID().toString();
        final String url;
        final String nome;
        final long iniciada = System.currentTimeMillis();
        volatile String status = "pending";
        volatile long recebidos;
        volatile Long total;
        volatile Long velocidade;
        volatile String erro;
        volatile String caminho;
        volatile Long terminada;
        volatile boolean cancelar;

        Tarefa(String url, String nome) { this.url = url; this.nome = nome; }

        JSONObject json() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id).put("url", url).put("filename", nome).put("status", status)
                    .put("receivedBytes", recebidos).put("totalBytes", total == null ? JSONObject.NULL : total)
                    .put("bytesPerSecond", velocidade == null ? JSONObject.NULL : velocidade).put("attempts", 1)
                    .put("startedAt", iso(iniciada)).put("finishedAt", terminada == null ? JSONObject.NULL : iso(terminada))
                    .put("error", erro == null ? JSONObject.NULL : erro)
                    .put("path", "done".equals(status) && caminho != null ? caminho : JSONObject.NULL);
            return o;
        }
    }

    private final Context contexto;
    private final Map<String, Tarefa> tarefas = new LinkedHashMap<>();
    /** Um download de cada vez: o DATASUS derruba conexões em paralelo. */
    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    LocalAndroid(Context contexto) {
        this.contexto = contexto.getApplicationContext();
    }

    private static String iso(long instante) {
        SimpleDateFormat formato = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        formato.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formato.format(new Date(instante));
    }

    String saude(String versaoDoApp) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("service", "tabwin-bridge").put("protocol", 1).put("app", "tabsis-android").put("version", versaoDoApp)
                .put("features", new JSONArray(Arrays.asList("ftp", "guardados", "arquivos")))
                .put("directory", "Downloads/TabSis")
                .put("allowlist", new JSONArray(Arrays.asList(
                        "ftp://" + FTP_HOST + FTP_RAIZ + "…  (árvore pública de microdados do DATASUS)",
                        "https://" + FTP_HOST + FTP_RAIZ + "…  (árvore pública de microdados do DATASUS)",
                        "https://datasus.saude.gov.br/wp-content/zipupload/…/arquivo.zip  (pacote preparado pelo catálogo oficial)")));
        return o.toString();
    }

    // ------------------------------------------------------------ política

    static URI validarUrl(String bruta) throws Recusado {
        URI url;
        try {
            url = new URI(bruta.trim());
        } catch (Exception e) {
            throw new Recusado("o endereço não é uma URL válida");
        }
        String esquema = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        String caminho = url.getPath() == null ? "" : url.getPath();
        if (url.getUserInfo() != null) throw new Recusado("a URL não pode carregar usuário ou senha");
        int porta = url.getPort();
        if (porta != -1 && porta != ("ftp".equals(esquema) ? 21 : 443)) throw new Recusado("porta não permitida");
        if (url.getRawQuery() != null || url.getRawFragment() != null || caminho.contains("\\") || Arrays.asList(caminho.split("/")).contains("..")) {
            throw new Recusado("o caminho não corresponde ao que essa origem publica");
        }
        boolean arvore = FTP_HOST.equals(host) && caminho.startsWith(FTP_RAIZ) && caminho.length() > FTP_RAIZ.length()
                && ("ftp".equals(esquema) || "https".equals(esquema));
        boolean preparado = "https".equals(esquema) && "datasus.saude.gov.br".equals(host)
                && caminho.startsWith("/wp-content/zipupload/") && caminho.endsWith("/arquivo.zip");
        if (!arvore && !preparado) throw new Recusado("o endereço não está na lista do que o app pode baixar");
        return url;
    }

    static String nomeSeguro(String bruto) throws Recusado {
        String nome = Normalizer.normalize(bruto, Normalizer.Form.NFKC);
        nome = nome.substring(Math.max(nome.lastIndexOf('/'), nome.lastIndexOf('\\')) + 1);
        nome = nome.replaceAll("[^A-Za-z0-9._ -]", "_").trim().replaceAll("\\.{2,}", ".").replaceAll("^[._-]+", "");
        while (nome.endsWith(".") || nome.endsWith(" ")) nome = nome.substring(0, nome.length() - 1);
        if (nome.length() > 120) nome = nome.substring(0, 120);
        if (nome.isEmpty() || RESERVADOS.contains(nome.split("\\.")[0].toUpperCase(Locale.ROOT))) throw new Recusado("nome de arquivo inválido");
        return nome;
    }

    static String nomeDoUrl(URI url) throws Recusado {
        String[] partes = url.getPath().replaceAll("^/+|/+$", "").split("/");
        String ultimo = partes[partes.length - 1];
        // Todo pacote preparado se chama arquivo.zip: o identificador do pedido vai junto.
        return nomeSeguro("arquivo.zip".equals(ultimo) && partes.length > 1 ? partes[partes.length - 2] + "-" + ultimo : ultimo);
    }

    private static boolean ehDeDados(String nome) {
        int ponto = nome.lastIndexOf('.');
        return ponto >= 0 && EXTENSOES.contains(nome.substring(ponto).toLowerCase(Locale.ROOT));
    }

    // ------------------------------------------------------------ pedidos do site

    /** Rota do protocolo → {status, corpo}. Só as rotas de texto; arquivo e guardados têm caminho próprio. */
    String pedido(String metodo, String rota, String corpo) {
        JSONObject resposta = new JSONObject();
        try {
            int status;
            String saida;
            Matcher tarefa = Pattern.compile("/downloads/([0-9a-f-]{36})(/cancel)?").matcher(rota);
            if ("POST".equals(metodo) && "/downloads".equals(rota)) {
                String url = new JSONObject(corpo == null || corpo.isEmpty() ? "{}" : corpo).optString("url", "");
                status = 202;
                saida = iniciar(url).json().toString();
            } else if ("GET".equals(metodo) && "/arquivos".equals(rota)) {
                status = 200;
                saida = new JSONObject().put("directory", "Downloads/TabSis").put("files", arquivos()).toString();
            } else if (tarefa.matches()) {
                Tarefa achada;
                synchronized (tarefas) { achada = tarefas.get(tarefa.group(1)); }
                if (achada == null) {
                    status = 404;
                    saida = new JSONObject().put("error", "download desconhecido").toString();
                } else {
                    if (tarefa.group(2) != null && "POST".equals(metodo)) achada.cancelar = true;
                    status = 200;
                    saida = achada.json().toString();
                }
            } else {
                status = 404;
                saida = new JSONObject().put("error", "rota desconhecida").toString();
            }
            resposta.put("status", status).put("corpo", saida);
        } catch (Recusado e) {
            put(resposta, 400, e.getMessage(), "recusado");
        } catch (Exception e) {
            put(resposta, 400, String.valueOf(e.getMessage()), "bad-request");
        }
        return resposta.toString();
    }

    private static void put(JSONObject resposta, int status, String erro, String codigo) {
        try {
            resposta.put("status", status).put("corpo", new JSONObject().put("error", erro).put("code", codigo).toString());
        } catch (JSONException ignorado) {
            // JSONObject.put só falha com número inválido.
        }
    }

    private Tarefa iniciar(String bruta) throws Recusado {
        URI url = validarUrl(bruta);
        Tarefa nova = new Tarefa(url.toString(), nomeDoUrl(url));
        synchronized (tarefas) {
            // O mesmo arquivo já na fila ou baixando: devolve o pedido que existe.
            for (Tarefa existente : tarefas.values()) {
                if (existente.url.equals(nova.url) && ("pending".equals(existente.status) || "downloading".equals(existente.status))) return existente;
            }
            tarefas.put(nova.id, nova);
        }
        fila.execute(() -> baixar(nova));
        return nova;
    }

    // ------------------------------------------------------------ download

    private void baixar(Tarefa tarefa) {
        if (tarefa.cancelar) {
            tarefa.status = "cancelled";
            tarefa.terminada = System.currentTimeMillis();
            return;
        }
        tarefa.status = "downloading";
        ContentResolver resolver = contexto.getContentResolver();
        Uri destino = null;
        try {
            URI url = validarUrl(tarefa.url);
            apagar(tarefa.nome, PASTA);  // baixar de novo substitui a cópia anterior
            ContentValues valores = new ContentValues();
            valores.put(MediaStore.Downloads.DISPLAY_NAME, tarefa.nome);
            valores.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
            valores.put(MediaStore.Downloads.RELATIVE_PATH, PASTA);
            valores.put(MediaStore.Downloads.IS_PENDING, 1);
            destino = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores);
            if (destino == null) throw new IOException("o Android não criou o arquivo em Downloads");
            try (OutputStream saida = resolver.openOutputStream(destino)) {
                if (saida == null) throw new IOException("sem acesso a Downloads");
                if ("ftp".equals(url.getScheme())) baixarFtp(url, tarefa, saida);
                else baixarHttps(url, tarefa, saida);
            }
            if (tarefa.total != null && tarefa.recebidos != tarefa.total) {
                throw new IOException("veio " + tarefa.recebidos + " de " + tarefa.total + " bytes; tente de novo");
            }
            valores.clear();
            valores.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(destino, valores, null, null);
            tarefa.caminho = "Downloads/TabSis/" + tarefa.nome;
            tarefa.status = "done";
        } catch (CanceladoException e) {
            tarefa.status = "cancelled";
            if (destino != null) resolver.delete(destino, null, null);
        } catch (Exception e) {
            tarefa.status = "failed";
            tarefa.erro = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            if (destino != null) resolver.delete(destino, null, null);
        } finally {
            tarefa.terminada = System.currentTimeMillis();
        }
    }

    private static final class CanceladoException extends IOException {}

    private static void copiar(InputStream entrada, OutputStream saida, Tarefa tarefa) throws IOException {
        long inicio = System.currentTimeMillis();
        byte[] buffer = new byte[256 * 1024];
        for (int lidos; (lidos = entrada.read(buffer)) > 0; ) {
            if (tarefa.cancelar) throw new CanceladoException();
            saida.write(buffer, 0, lidos);
            tarefa.recebidos += lidos;
            if (tarefa.recebidos > MAXIMO) throw new IOException("arquivo maior que 1 GB");
            tarefa.velocidade = tarefa.recebidos * 1000 / Math.max(1, System.currentTimeMillis() - inicio);
        }
    }

    private static void baixarHttps(URI url, Tarefa tarefa, OutputStream saida) throws IOException {
        HttpURLConnection conexao = (HttpURLConnection) new URL(url.toString()).openConnection();
        conexao.setConnectTimeout(60_000);
        conexao.setReadTimeout(60_000);
        conexao.setInstanceFollowRedirects(false);  // um redirecionamento sairia da lista do que é permitido
        conexao.setRequestProperty("User-Agent", "TabSis-Android");
        try {
            int codigo = conexao.getResponseCode();
            if (codigo != 200) throw new IOException("o DATASUS respondeu HTTP " + codigo);
            long tamanho = conexao.getContentLengthLong();
            tarefa.total = tamanho >= 0 ? tamanho : null;
            try (InputStream entrada = conexao.getInputStream()) {
                copiar(entrada, saida, tarefa);
            }
        } finally {
            conexao.disconnect();
        }
    }

    /** FTP anônimo, passivo e binário: o mínimo para o RETR de um arquivo do DATASUS. */
    private static void baixarFtp(URI url, Tarefa tarefa, OutputStream saida) throws IOException {
        String caminho = url.getPath();
        try (Socket controle = new Socket()) {
            controle.connect(new InetSocketAddress(FTP_HOST, 21), 30_000);
            controle.setSoTimeout(60_000);
            BufferedReader leitor = new BufferedReader(new InputStreamReader(controle.getInputStream(), StandardCharsets.ISO_8859_1));
            Writer escritor = new OutputStreamWriter(controle.getOutputStream(), StandardCharsets.ISO_8859_1);
            esperar(leitor, "220");
            comando(escritor, "USER anonymous");
            String resposta = resposta(leitor);
            if (resposta.startsWith("331")) {
                comando(escritor, "PASS tabsis@tabweb.me");
                exigir(resposta(leitor), "230");
            } else exigir(resposta, "230");
            comando(escritor, "TYPE I");
            exigir(resposta(leitor), "200");
            comando(escritor, "SIZE " + caminho);
            resposta = resposta(leitor);
            if (resposta.startsWith("213")) {
                try { tarefa.total = Long.parseLong(resposta.substring(4).trim()); } catch (NumberFormatException ignorado) { tarefa.total = null; }
            } else if (resposta.startsWith("550")) {
                throw new IOException("o arquivo não está no FTP do DATASUS");
            }
            comando(escritor, "PASV");
            resposta = resposta(leitor);
            exigir(resposta, "227");
            Matcher numeros = Pattern.compile("(\\d+),(\\d+),(\\d+),(\\d+),(\\d+),(\\d+)").matcher(resposta);
            if (!numeros.find()) throw new IOException("o FTP não informou a porta de dados");
            int porta = Integer.parseInt(numeros.group(5)) * 256 + Integer.parseInt(numeros.group(6));
            try (Socket dados = new Socket()) {
                // O endereço da resposta PASV pode ser interno do DATASUS: usa o mesmo host do controle.
                dados.connect(new InetSocketAddress(FTP_HOST, porta), 30_000);
                dados.setSoTimeout(60_000);
                comando(escritor, "RETR " + caminho);
                resposta = resposta(leitor);
                if (!resposta.startsWith("150") && !resposta.startsWith("125")) throw new IOException("o FTP recusou o arquivo: " + resposta);
                try (InputStream entrada = dados.getInputStream()) {
                    copiar(entrada, saida, tarefa);
                }
            }
            exigir(resposta(leitor), "226");
            try { comando(escritor, "QUIT"); } catch (IOException ignorado) { /* fechar não pode esconder o resultado */ }
        }
    }

    private static void comando(Writer escritor, String linha) throws IOException {
        escritor.write(linha + "\r\n");
        escritor.flush();
    }

    /** Uma resposta inteira do FTP, inclusive as de várias linhas ("220-…" até "220 …"). */
    private static String resposta(BufferedReader leitor) throws IOException {
        String linha = leitor.readLine();
        if (linha == null) throw new IOException("o FTP fechou a conexão");
        if (linha.length() >= 4 && linha.charAt(3) == '-') {
            String fim = linha.substring(0, 3) + " ";
            String seguinte;
            do {
                seguinte = leitor.readLine();
                if (seguinte == null) throw new IOException("o FTP fechou a conexão");
            } while (!seguinte.startsWith(fim));
        }
        return linha;
    }

    private static void esperar(BufferedReader leitor, String codigo) throws IOException {
        exigir(resposta(leitor), codigo);
    }

    private static void exigir(String resposta, String codigo) throws IOException {
        if (!resposta.startsWith(codigo)) throw new IOException("resposta inesperada do FTP: " + resposta);
    }

    // ------------------------------------------------------------ a pasta

    private Uri achar(String nome, String pasta) {
        String[] colunas = { MediaStore.Downloads._ID };
        try (Cursor cursor = contexto.getContentResolver().query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, colunas,
                MediaStore.Downloads.DISPLAY_NAME + "=? AND " + MediaStore.Downloads.RELATIVE_PATH + "=?", new String[] { nome, pasta }, null)) {
            if (cursor != null && cursor.moveToFirst()) return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getLong(0));
        }
        return null;
    }

    private void apagar(String nome, String pasta) {
        Uri existente = achar(nome, pasta);
        if (existente != null) contexto.getContentResolver().delete(existente, null, null);
    }

    /** Os arquivos de dados de Downloads/TabSis (e dos guardados), mais novos primeiro. */
    JSONArray arquivos() throws JSONException {
        List<JSONObject> itens = new ArrayList<>();
        String[] colunas = { MediaStore.Downloads.DISPLAY_NAME, MediaStore.Downloads.SIZE, MediaStore.Downloads.DATE_MODIFIED, MediaStore.Downloads.RELATIVE_PATH };
        try (Cursor cursor = contexto.getContentResolver().query(MediaStore.Downloads.EXTERNAL_CONTENT_URI, colunas,
                MediaStore.Downloads.RELATIVE_PATH + " IN (?, ?) AND " + MediaStore.Downloads.IS_PENDING + "=0",
                new String[] { PASTA, PASTA_GUARDADOS }, MediaStore.Downloads.DATE_MODIFIED + " DESC")) {
            while (cursor != null && cursor.moveToNext()) {
                String nome = cursor.getString(0);
                if (nome == null || !ehDeDados(nome)) continue;
                boolean guardado = PASTA_GUARDADOS.equals(cursor.getString(3));
                itens.add(new JSONObject().put("nome", nome).put("pasta", guardado ? "guardados" : "principal")
                        .put("bytes", cursor.getLong(1)).put("modificado", cursor.getLong(2))
                        .put("caminho", (guardado ? "Downloads/TabSis/Guardados do navegador/" : "Downloads/TabSis/") + nome));
            }
        }
        return new JSONArray(itens);
    }

    /** Para o site ler um arquivo da pasta (rota /__local/arquivo, interceptada pelo WebView). */
    InputStream abrir(String nome, String pasta) throws Recusado, IOException {
        String limpo = nomeSeguro(URLDecoder.decode(nome, "UTF-8"));
        if (!ehDeDados(limpo)) throw new Recusado("arquivo não encontrado na pasta do TabSis");
        Uri uri = achar(limpo, "guardados".equals(pasta) ? PASTA_GUARDADOS : PASTA);
        if (uri == null) throw new Recusado("arquivo não encontrado na pasta do TabSis");
        InputStream entrada = contexto.getContentResolver().openInputStream(uri);
        if (entrada == null) throw new IOException("sem acesso ao arquivo");
        return entrada;
    }

    /** Um arquivo que estava em cache no navegador, já montado em `temporario` pela ponte. */
    String guardar(File temporario, String nome) throws Recusado, IOException, JSONException {
        String limpo = nomeSeguro(nome);
        long tamanho = temporario.length();
        if (tamanho <= 0 || tamanho > MAXIMO) throw new Recusado("tamanho inválido");
        ContentResolver resolver = contexto.getContentResolver();
        apagar(limpo, PASTA_GUARDADOS);
        ContentValues valores = new ContentValues();
        valores.put(MediaStore.Downloads.DISPLAY_NAME, limpo);
        valores.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
        valores.put(MediaStore.Downloads.RELATIVE_PATH, PASTA_GUARDADOS);
        valores.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores);
        if (uri == null) throw new IOException("o Android não criou o arquivo em Downloads");
        MessageDigest resumo;
        try {
            resumo = MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new IOException(e);
        }
        try (InputStream entrada = new FileInputStream(temporario); OutputStream saida = resolver.openOutputStream(uri)) {
            if (saida == null) throw new IOException("sem acesso a Downloads");
            byte[] buffer = new byte[256 * 1024];
            for (int lidos; (lidos = entrada.read(buffer)) > 0; ) {
                resumo.update(buffer, 0, lidos);
                saida.write(buffer, 0, lidos);
            }
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        valores.clear();
        valores.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, valores, null, null);
        StringBuilder hex = new StringBuilder();
        for (byte b : resumo.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
        return new JSONObject().put("path", "Downloads/TabSis/Guardados do navegador/" + limpo).put("bytes", tamanho).put("sha256", hex.toString()).toString();
    }
}
