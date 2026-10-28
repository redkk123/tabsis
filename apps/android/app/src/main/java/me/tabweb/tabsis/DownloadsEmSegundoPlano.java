package me.tabweb.tabsis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import java.util.Locale;

/**
 * Segura os downloads do TabSis Local com o app em segundo plano ou a tela
 * apagada: um serviço em primeiro plano (o Android exige a notificação), com o
 * nome do arquivo, a porcentagem e quantos faltam. Quando a fila esvazia, ele
 * sai sozinho e deixa uma notificação de "baixado" ou de falha.
 *
 * O download em si continua em {@link LocalAndroid}; aqui só se mantém o
 * processo vivo e se mostra o progresso.
 */
public class DownloadsEmSegundoPlano extends Service {
    private static final String CANAL = "downloads";
    private static final int EM_ANDAMENTO = 1;
    private static final int TERMINOU = 2;

    private final Handler relogio = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock acordado;
    private boolean emPrimeiroPlano;
    /** Um download novo que chega enquanto o serviço fecha não pode ser largado sem o primeiro plano. */
    private int ultimoPedido;

    /** Chamado quando um download entra na fila. Fora da tela o Android pode recusar: o download segue igual. */
    static void comecar(Context contexto) {
        try {
            contexto.startForegroundService(new Intent(contexto, DownloadsEmSegundoPlano.class));
        } catch (RuntimeException recusado) {
            // Android 12+: sem a tela à frente não deixa começar; o download continua enquanto o app viver.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager gerente = getSystemService(NotificationManager.class);
        NotificationChannel canal = new NotificationChannel(CANAL, "Downloads do DATASUS", NotificationManager.IMPORTANCE_LOW);
        canal.setDescription("Progresso dos arquivos que o TabSis baixa para Downloads/TabSis");
        gerente.createNotificationChannel(canal);
        PowerManager energia = getSystemService(PowerManager.class);
        acordado = energia.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TabSis:downloads");
        // Teto de segurança: o serviço solta antes, quando a fila esvazia.
        acordado.acquire(6L * 60 * 60 * 1000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ultimoPedido = startId;
        if (!emPrimeiroPlano) {
            startForeground(EM_ANDAMENTO, notificacao(LocalAndroid.instancia() == null ? null : LocalAndroid.instancia().situacao()),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            emPrimeiroPlano = true;
            relogio.post(this::atualizar);
        }
        // Se o Android matar o processo, não recomeça sozinho: a fila morava na memória.
        return START_NOT_STICKY;
    }

    private void atualizar() {
        LocalAndroid local = LocalAndroid.instancia();
        LocalAndroid.Situacao situacao = local == null ? null : local.situacao();
        if (situacao == null) {
            terminar(local);
            return;
        }
        getSystemService(NotificationManager.class).notify(EM_ANDAMENTO, notificacao(situacao));
        relogio.postDelayed(this::atualizar, 1000);
    }

    private void terminar(LocalAndroid local) {
        relogio.removeCallbacksAndMessages(null);
        stopForeground(STOP_FOREGROUND_REMOVE);
        emPrimeiroPlano = false;
        if (local != null) {
            String[][] fim = local.terminadosDesdeAUltima();
            String[] ok = fim[0];
            String[] falhou = fim[1];
            if (ok.length > 0 || falhou.length > 0) {
                String titulo = falhou.length == 0
                        ? (ok.length == 1 ? ok[0] + " baixado" : ok.length + " arquivos baixados")
                        : (falhou.length == 1 ? "Não deu para baixar " + falhou[0] : falhou.length + " arquivos não baixaram");
                String texto = falhou.length == 0 ? "Em Downloads/TabSis. Toque para abrir o TabSis."
                        : (ok.length > 0 ? ok.length + " baixado(s); abra o TabSis para ver o motivo." : "Abra o TabSis para ver o motivo e tentar de novo.");
                getSystemService(NotificationManager.class).notify(TERMINOU, base().setContentTitle(titulo).setContentText(texto)
                        .setSmallIcon(falhou.length == 0 ? android.R.drawable.stat_sys_download_done : android.R.drawable.stat_notify_error)
                        .setAutoCancel(true).build());
            }
        }
        stopSelfResult(ultimoPedido);
    }

    private NotificationCompat.Builder base() {
        Intent abrir = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return new NotificationCompat.Builder(this, CANAL)
                .setContentIntent(PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .setColor(getColor(R.color.tabsis_azul))
                .setOnlyAlertOnce(true);
    }

    private Notification notificacao(LocalAndroid.Situacao situacao) {
        NotificationCompat.Builder b = base().setSmallIcon(android.R.drawable.stat_sys_download).setOngoing(true)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (situacao == null || situacao.nome.isEmpty()) {
            return b.setContentTitle("TabSis: preparando o download").setProgress(0, 0, true).build();
        }
        String fila = situacao.naFila > 0 ? " · mais " + situacao.naFila + " na fila" : "";
        String reconectando = situacao.tentativa > 1 ? " · reconectou (tentativa " + situacao.tentativa + ")" : "";
        b.setContentTitle("Baixando " + situacao.nome);
        if (situacao.total != null && situacao.total > 0) {
            int pct = (int) Math.min(100, situacao.recebidos * 100 / situacao.total);
            b.setProgress(100, pct, false).setContentText(pct + "% · " + mb(situacao.recebidos) + " de " + mb(situacao.total) + fila + reconectando);
        } else {
            b.setProgress(0, 0, true).setContentText(mb(situacao.recebidos) + fila + reconectando);
        }
        return b.build();
    }

    private static String mb(long bytes) {
        return String.format(Locale.forLanguageTag("pt-BR"), "%.1f MB", bytes / 1048576.0);
    }

    /** Android 15: o tipo "sincronização de dados" tem um teto diário; ao chegar nele, solta o primeiro plano. */
    @Override
    public void onTimeout(int startId, int tipo) {
        terminar(LocalAndroid.instancia());
    }

    @Override
    public void onDestroy() {
        relogio.removeCallbacksAndMessages(null);
        if (acordado != null && acordado.isHeld()) acordado.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
