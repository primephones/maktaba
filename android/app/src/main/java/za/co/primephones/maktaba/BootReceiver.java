package za.co.primephones.maktaba;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * After the phone restarts, or Maktaba is updated, says so if books were still being
 * prepared. Opening the app carries on from where it stopped.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        SharedPreferences prefs = ctx.getSharedPreferences(MaktabaPlugin.PREFS, Context.MODE_PRIVATE);
        String pending = prefs.getString(MaktabaPlugin.PREF_PENDING, null);
        if (pending == null || pending.isEmpty()) return;
        Notifications.ensureChannels(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, Notifications.CHANNEL_NOTICES)
            .setSmallIcon(R.drawable.ic_stat_maktaba)
            .setContentTitle("Maktaba has unfinished work")
            .setContentText(pending + " Open Maktaba to carry on.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(pending + " Open Maktaba to carry on."))
            .setContentIntent(Notifications.openApp(ctx))
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(Notifications.ID_RESUME, b.build());
        } catch (SecurityException e) {
            // Notifications not allowed.
        }
    }
}
