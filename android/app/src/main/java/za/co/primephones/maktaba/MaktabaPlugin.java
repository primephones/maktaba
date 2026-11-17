package za.co.primephones.maktaba;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.view.WindowManager;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;

/**
 * The bridge between Maktaba's pages and Android: background work with a progress
 * notification, files shared or opened from other apps, volume-key page turning, keeping
 * the screen on, and the reading orientation.
 */
@CapacitorPlugin(
    name = "Maktaba",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class MaktabaPlugin extends Plugin {
    static final String PREFS = "maktaba";
    static final String PREF_PENDING = "pendingWork";
    private static final String HANDLED = "maktaba.handled";

    static volatile boolean volumeKeysEnabled = false;
    private static volatile MaktabaPlugin instance;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        instance = this;
        Notifications.ensureChannels(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        volumeKeysEnabled = false;
    }

    // ------------------------------------------------------------------ background work

    @PluginMethod
    public void startWork(PluginCall call) {
        boolean started = WorkService.start(
            getContext(),
            call.getString("title", "Preparing books"),
            call.getString("text", ""),
            call.getInt("done", 0),
            call.getInt("total", 0)
        );
        JSObject ret = new JSObject();
        ret.put("started", started);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateWork(PluginCall call) {
        Context ctx = getContext();
        String title = call.getString("title", "Preparing books");
        String text = call.getString("text", "");
        int done = call.getInt("done", 0);
        int total = call.getInt("total", 0);
        if (WorkService.isRunning()) WorkService.update(ctx, title, text, done, total);
        else WorkService.start(ctx, title, text, done, total);
        call.resolve();
    }

    @PluginMethod
    public void stopWork(PluginCall call) {
        WorkService.stop(getContext());
        call.resolve();
    }

    /** Remembers, for after a restart, that work was left unfinished (empty text clears it). */
    @PluginMethod
    public void setPendingWork(PluginCall call) {
        String text = call.getString("text", "");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_PENDING, text).apply();
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    // ------------------------------------------------------------------ reading

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeysEnabled = call.getBoolean("enabled", false);
        call.resolve();
    }

    static void onVolumeKey(int direction) {
        MaktabaPlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("direction", direction);
        p.notifyListeners("volumeKey", data);
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    /** "auto", "portrait" or "landscape". */
    @PluginMethod
    public void setOrientation(PluginCall call) {
        String o = call.getString("orientation", "auto");
        int value = "portrait".equals(o)
            ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            : "landscape".equals(o) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        Activity a = getActivity();
        a.runOnUiThread(() -> a.setRequestedOrientation(value));
        call.resolve();
    }

    // ------------------------------------------------------------------ files from other apps

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        receive(intent);
    }

    /** Deletes the copies of shared files once the app has stored them. */
    @PluginMethod
    public void releaseSharedFiles(PluginCall call) {
        JSArray paths = call.getArray("paths", new JSArray());
        File root = sharedDir();
        try {
            for (int i = 0; i < paths.length(); i++) {
                File f = new File(paths.getString(i));
                // Only ever delete inside our own folder for shared files.
                if (f.getCanonicalPath().startsWith(root.getCanonicalPath())) {
                    f.delete();
                    File parent = f.getParentFile();
                    if (parent != null && !parent.equals(root)) parent.delete();
                }
            }
        } catch (Exception e) {
            // Leftovers are cleared with the cache.
        }
        call.resolve();
    }

    private File sharedDir() {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private void receive(Intent intent) {
        if (intent == null || intent.getBooleanExtra(HANDLED, false)) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (list != null) uris.addAll(list);
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else {
            return;
        }
        intent.putExtra(HANDLED, true);

        if (uris.isEmpty()) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                JSObject data = new JSObject();
                data.put("text", text.toString());
                notifyListeners("sharedText", data, true);
            }
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        io.execute(() -> {
            JSONArray files = new JSONArray();
            JSONArray failed = new JSONArray();
            for (Uri uri : uris) {
                String name = displayName(resolver, uri);
                try {
                    File dir = new File(sharedDir(), UUID.randomUUID().toString());
                    dir.mkdirs();
                    File out = new File(dir, safeName(name));
                    long size = 0;
                    try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                        if (in == null) throw new IllegalStateException("No data");
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            os.write(buf, 0, n);
                            size += n;
                        }
                    }
                    JSObject f = new JSObject();
                    f.put("path", out.getAbsolutePath());
                    f.put("name", name);
                    f.put("mime", resolver.getType(uri));
                    f.put("size", size);
                    files.put(f);
                } catch (Exception e) {
                    failed.put(name);
                }
            }
            JSObject data = new JSObject();
            data.put("files", files);
            data.put("failed", failed);
            notifyListeners("sharedFiles", data, true);
        });
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception e) {
                // Fall back to the last part of the address.
            }
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        return name == null || name.isEmpty() ? "Shared book" : name;
    }

    private static String safeName(String name) {
        String s = name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_");
        if (s.length() > 120) s = s.substring(s.length() - 120);
        return s.isEmpty() ? "book" : s;
    }
}
