package za.co.primephones.maktaba;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps Maktaba running while books are being prepared, so the work carries on when the
 * reader switches to another app or the screen goes off. Android otherwise freezes an app
 * that is out of sight. The notification shows what is being done and how far it has got.
 */
public class WorkService extends Service {
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_TEXT = "text";
    private static final String EXTRA_DONE = "done";
    private static final String EXTRA_TOTAL = "total";
    /** Long enough for a whole book; released as soon as the work ends. */
    private static final long WAKE_LIMIT_MS = 6L * 60 * 60 * 1000;

    private static volatile boolean running = false;
    private PowerManager.WakeLock wakeLock;

    static boolean isRunning() {
        return running;
    }

    static Notification build(Context ctx, String title, String text, int done, int total) {
        Notifications.ensureChannels(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, Notifications.CHANNEL_WORK)
            .setSmallIcon(R.drawable.ic_stat_maktaba)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(Notifications.openApp(ctx))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (total > 0) b.setProgress(total, Math.min(done, total), false);
        else b.setProgress(0, 0, true);
        return b.build();
    }

    /** Starts the service. Returns false when Android does not allow it right now. */
    static boolean start(Context ctx, String title, String text, int done, int total) {
        Intent i = new Intent(ctx, WorkService.class)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_TEXT, text)
            .putExtra(EXTRA_DONE, done)
            .putExtra(EXTRA_TOTAL, total);
        try {
            ContextCompat.startForegroundService(ctx, i);
            return true;
        } catch (RuntimeException e) {
            // Android 12+ refuses to start a foreground service from the background.
            return false;
        }
    }

    /** Updates the notification of a running service without restarting it. */
    static void update(Context ctx, String title, String text, int done, int total) {
        if (!running) return;
        try {
            NotificationManagerCompat.from(ctx).notify(Notifications.ID_WORK, build(ctx, title, text, done, total));
        } catch (SecurityException e) {
            // Notifications not allowed: the work still continues.
        }
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, WorkService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        int done = intent != null ? intent.getIntExtra(EXTRA_DONE, 0) : 0;
        int total = intent != null ? intent.getIntExtra(EXTRA_TOTAL, 0) : 0;
        Notification n = build(this, title != null ? title : "Preparing books", text != null ? text : "", done, total);
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, Notifications.ID_WORK, n, type);
        running = true;
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Maktaba:work");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(WAKE_LIMIT_MS);
            }
        }
        // If Android ends the process, the app picks the work up again when next opened.
        return START_NOT_STICKY;
    }

    /** Android 15 caps background data work; end cleanly when time is up. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
