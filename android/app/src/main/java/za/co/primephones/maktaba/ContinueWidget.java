package za.co.primephones.maktaba;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * The home-screen widget: the book being read, where in it, and how far. A tap opens Maktaba
 * at that book. The app tells it what to show each time the reader's place changes.
 */
public class ContinueWidget extends AppWidgetProvider {
    static final String PREFS = "maktaba_widget";
    static final String EXTRA_OPEN_BOOK = "openBook";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
    }

    /** Saves what the widget shows, and redraws every widget on the home screen. */
    static void save(Context ctx, String bookId, String title, String where, int percent) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("bookId", bookId)
            .putString("title", title)
            .putString("where", where)
            .putInt("percent", percent)
            .apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ContinueWidget.class));
        if (ids != null && ids.length > 0) render(ctx, mgr, ids);
    }

    static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String bookId = p.getString("bookId", null);
        String title = p.getString("title", null);
        String where = p.getString("where", "");
        int percent = p.getInt("percent", 0);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_continue);
        if (title == null) {
            v.setTextViewText(R.id.widget_eyebrow, "Maktaba");
            v.setTextViewText(R.id.widget_title, "Open a book to see it here");
            v.setTextViewText(R.id.widget_where, "");
            v.setProgressBar(R.id.widget_progress, 100, 0, false);
        } else {
            v.setTextViewText(R.id.widget_eyebrow, "Continue reading");
            v.setTextViewText(R.id.widget_title, title);
            v.setTextViewText(R.id.widget_where, where + (where.isEmpty() ? "" : " · ") + percent + "%");
            v.setProgressBar(R.id.widget_progress, 100, Math.max(0, Math.min(100, percent)), false);
        }
        Intent open = new Intent(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (bookId != null) open.putExtra(EXTRA_OPEN_BOOK, bookId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 7, open, flags));
        mgr.updateAppWidget(ids, v);
    }
}
