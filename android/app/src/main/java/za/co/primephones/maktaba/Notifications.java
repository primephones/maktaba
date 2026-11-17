package za.co.primephones.maktaba;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** The app's notification channels and the tap action they share. */
final class Notifications {
    static final String CHANNEL_WORK = "work";
    static final String CHANNEL_NOTICES = "notices";
    static final int ID_WORK = 1001;
    static final int ID_RESUME = 1002;

    private Notifications() {}

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel work = new NotificationChannel(CHANNEL_WORK, "Preparing books", NotificationManager.IMPORTANCE_LOW);
        work.setDescription("Progress while books are imported and processed in the background.");
        work.setShowBadge(false);
        nm.createNotificationChannel(work);
        NotificationChannel notices = new NotificationChannel(CHANNEL_NOTICES, "Reminders", NotificationManager.IMPORTANCE_DEFAULT);
        notices.setDescription("When unfinished work is waiting for you to open Maktaba.");
        nm.createNotificationChannel(notices);
    }

    /** Opens the app where it was. */
    static PendingIntent openApp(Context ctx) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, 0, intent, flags);
    }
}
