package za.co.primephones.maktaba;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.net.Uri;
import androidx.core.content.FileProvider;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.content.ContentValues;
import android.os.Environment;
import android.util.Base64;
import java.util.HashMap;
import java.util.Map;
import android.view.WindowManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.Locale;
import java.util.Set;
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
        if (tts != null) tts.shutdown();
        tts = null;
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

    // ------------------------------------------------------------------ reading aloud

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private final List<Runnable> afterTts = new ArrayList<>();
    private final List<PluginCall> callsWaitingForTts = new ArrayList<>();

    /** Runs `then` once the phone's speech engine is ready; rejects the call if there is none. */
    private void withTts(PluginCall call, Runnable then) {
        if (tts != null && ttsReady) {
            then.run();
            return;
        }
        afterTts.add(then);
        callsWaitingForTts.add(call);
        if (tts != null) return;
        tts = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) {
                        emitSpeech("start", id, -1, -1);
                    }

                    @Override
                    public void onDone(String id) {
                        emitSpeech("done", id, -1, -1);
                    }

                    @Override
                    @Deprecated
                    public void onError(String id) {
                        emitSpeech("error", id, -1, -1);
                    }

                    @Override
                    public void onRangeStart(String id, int start, int end, int frame) {
                        emitSpeech("range", id, start, end);
                    }

                    @Override
                    public void onStop(String id, boolean interrupted) {
                        emitSpeech("stopped", id, -1, -1);
                    }
                });
                for (Runnable r : new ArrayList<>(afterTts)) r.run();
            } else {
                for (PluginCall c : new ArrayList<>(callsWaitingForTts)) c.reject("This phone has no text-to-speech engine.");
                tts = null;
            }
            afterTts.clear();
            callsWaitingForTts.clear();
        });
    }

    private void emitSpeech(String type, String id, int start, int end) {
        JSObject data = new JSObject();
        data.put("type", type);
        data.put("id", id);
        if (start >= 0) {
            data.put("start", start);
            data.put("end", end);
        }
        notifyListeners("speech", data);
    }

    /** The voices installed on the phone for a language, best (offline, high quality) first. */
    @PluginMethod
    public void speechVoices(PluginCall call) {
        withTts(call, () -> {
            JSArray list = new JSArray();
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                for (Voice v : voices) {
                    JSObject o = new JSObject();
                    o.put("name", v.getName());
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("quality", v.getQuality());
                    o.put("offline", !v.isNetworkConnectionRequired());
                    list.put(o);
                }
            }
            JSObject ret = new JSObject();
            ret.put("voices", list);
            call.resolve(ret);
        });
    }

    /**
     * Queues one piece of speech. Each piece has its own voice, so an Arabic term inside an
     * English sentence can be said by an Arabic voice.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String id = call.getString("id", UUID.randomUUID().toString());
        String lang = call.getString("lang", "en");
        String voiceName = call.getString("voice", null);
        float rate = call.getFloat("rate", 1.0f);
        boolean flush = call.getBoolean("flush", false);
        withTts(call, () -> {
            Voice chosen = null;
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                for (Voice v : voices) {
                    if (voiceName != null && v.getName().equals(voiceName)) chosen = v;
                }
                if (chosen == null) {
                    for (Voice v : voices) {
                        if (v.getLocale().getLanguage().equals(new Locale(lang).getLanguage()) && !v.isNetworkConnectionRequired()
                            && (chosen == null || v.getQuality() > chosen.getQuality())) chosen = v;
                    }
                }
            }
            if (chosen != null) tts.setVoice(chosen);
            else tts.setLanguage(Locale.forLanguageTag(lang));
            tts.setSpeechRate(rate);
            int r = tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
            if (r == TextToSpeech.ERROR) call.reject("This piece could not be spoken.");
            else call.resolve();
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
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

    // ------------------------------------------------------------------ saving files (backups, exports)

    private static class Saving {
        final Uri uri;
        final OutputStream out;
        final String location;

        Saving(Uri uri, OutputStream out, String location) {
            this.uri = uri;
            this.out = out;
            this.location = location;
        }
    }

    private final Map<String, Saving> saving = new HashMap<>();

    /**
     * Starts saving a file to the phone's Downloads folder, where My Files shows it. The
     * page then sends the contents in pieces, so a large backup never has to fit in memory.
     */
    @PluginMethod
    public void saveFileBegin(PluginCall call) {
        String name = safeName(call.getString("name", "maktaba"));
        String mime = call.getString("mime", "application/octet-stream");
        Context ctx = getContext();
        try {
            Uri uri;
            OutputStream out;
            String location;
            if (call.getBoolean("temp", false)) {
                // A private copy only for opening in another app (the original file of a book).
                File dir = new File(ctx.getCacheDir(), "originals");
                dir.mkdirs();
                File f = new File(dir, name);
                uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
                out = new FileOutputStream(f);
                location = f.getAbsolutePath();
            } else if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Maktaba");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("Could not create the file");
                out = ctx.getContentResolver().openOutputStream(uri);
                location = "Downloads/Maktaba/" + name;
            } else {
                File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Maktaba");
                dir.mkdirs();
                File f = new File(dir, name);
                uri = Uri.fromFile(f);
                out = new FileOutputStream(f);
                location = f.getAbsolutePath();
            }
            if (out == null) throw new IllegalStateException("Could not open the file");
            String id = UUID.randomUUID().toString();
            saving.put(id, new Saving(uri, out, location));
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("The file could not be saved: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFileChunk(PluginCall call) {
        Saving s = saving.get(call.getString("id", ""));
        if (s == null) {
            call.reject("No file is being saved");
            return;
        }
        try {
            s.out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("Writing the file failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFileEnd(PluginCall call) {
        Saving s = saving.remove(call.getString("id", ""));
        if (s == null) {
            call.reject("No file is being saved");
            return;
        }
        try {
            s.out.close();
            if (Build.VERSION.SDK_INT >= 29 && "content".equals(s.uri.getScheme()) && s.uri.getAuthority() != null && s.uri.getAuthority().startsWith("media")) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContext().getContentResolver().update(s.uri, v, null, null);
            }
            JSObject ret = new JSObject();
            ret.put("location", s.location);
            ret.put("uri", s.uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Finishing the file failed: " + e.getMessage());
        }
    }

    /** Opens a web page in the phone's browser (for signing in to an AI service or a cloud). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "")));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the browser: " + e.getMessage());
        }
    }

    /** Opens a file in the phone's own app for it (a PDF viewer, an e-book reader, Word). */
    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, call.getString("mime", "application/octet-stream"));
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view.resolveActivity(getContext().getPackageManager()) == null) {
                call.reject("NO_APP");
                return;
            }
            getContext().startActivity(Intent.createChooser(view, call.getString("title", "Open with")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("Opening failed: " + e.getMessage());
        }
    }

    /** Opens the share sheet for a saved file, to send it to Drive, WhatsApp or email. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/octet-stream"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", "Send"));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Sharing failed: " + e.getMessage());
        }
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
        // A sign-in finishing in the browser hands back to the app as maktaba://auth?...
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null && "maktaba".equals(intent.getData().getScheme())) {
            intent.putExtra(HANDLED, true);
            JSObject data = new JSObject();
            data.put("url", intent.getData().toString());
            notifyListeners("authCallback", data, true);
            return;
        }
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
