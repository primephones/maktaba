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
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
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
        // Google's consent screen, shown when the reader first connects their Drive.
        authLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = pendingAuth;
            pendingAuth = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("CANCELLED");
                return;
            }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                resolveAuth(call, r);
            } catch (ApiException e) {
                call.reject("Google sign-in failed: " + e.getMessage());
            }
        });
    }

    // ------------------------------------------------------------------ the reader's own Google Drive

    private ActivityResultLauncher<IntentSenderRequest> authLauncher;
    private PluginCall pendingAuth;

    /**
     * An access token for the reader's own Google Drive, limited to the files Maktaba itself
     * makes there. The first time, Google asks the reader to choose an account and agree;
     * after that a fresh token comes back without asking (interactive: false never asks).
     */
    @PluginMethod
    public void googleAuthorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        List<Scope> scopes = new ArrayList<>();
        try {
            JSArray list = call.getArray("scopes", new JSArray());
            for (int i = 0; i < list.length(); i++) scopes.add(new Scope(list.getString(i)));
        } catch (Exception e) {
            call.reject("Bad scopes");
            return;
        }
        AuthorizationRequest req = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getActivity()).authorize(req)
            .addOnSuccessListener(r -> {
                if (r.hasResolution()) {
                    if (!interactive || r.getPendingIntent() == null) {
                        call.reject("NEEDS_CONSENT");
                        return;
                    }
                    pendingAuth = call;
                    authLauncher.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
                } else {
                    resolveAuth(call, r);
                }
            })
            .addOnFailureListener(e -> call.reject("Google sign-in failed: " + e.getMessage()));
    }

    private void resolveAuth(PluginCall call, AuthorizationResult r) {
        if (r.getAccessToken() == null) {
            call.reject("Google gave no access");
            return;
        }
        JSObject o = new JSObject();
        o.put("accessToken", r.getAccessToken());
        call.resolve(o);
    }

    @Override
    protected void handleOnDestroy() {
        stopSignInListener();
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

    /** Shares a piece of text (the link to Maktaba) through WhatsApp, email, messages... */
    @PluginMethod
    public void shareText(PluginCall call) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
            send.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Maktaba"));
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Sharing failed: " + e.getMessage());
        }
    }

    /** The listener catching a sign-in coming back from the browser, while one is open. */
    private java.net.ServerSocket signInSocket;

    /**
     * Waits for a sign-in to come back from the phone's browser at http://localhost:3000
     * (an address OpenRouter allows for apps), for up to ten minutes. This needs no website
     * of Maktaba's own: the code goes straight to the app, and the browser shows a page with
     * a button back. Resolves with the address to give the sign-in.
     */
    @PluginMethod
    public void listenForSignIn(PluginCall call) {
        stopSignInListener();
        final java.net.ServerSocket server;
        try {
            server = new java.net.ServerSocket();
            server.setReuseAddress(true);
            server.bind(new java.net.InetSocketAddress(java.net.InetAddress.getByName("127.0.0.1"), 3000));
            server.setSoTimeout(10 * 60 * 1000);
        } catch (Exception e) {
            call.reject("Could not wait for the sign-in: " + e.getMessage());
            return;
        }
        signInSocket = server;
        JSObject ok = new JSObject();
        ok.put("url", "http://localhost:3000/");
        call.resolve(ok);
        new Thread(() -> {
            try {
                while (!server.isClosed()) {
                    try (java.net.Socket s = server.accept()) {
                        s.setSoTimeout(10000);
                        java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(s.getInputStream(), "UTF-8"));
                        String line = in.readLine();
                        if (line == null) continue;
                        String[] parts = line.split(" ");
                        String path = parts.length > 1 ? parts[1] : "/";
                        Uri asked = Uri.parse("http://localhost" + path);
                        String code = asked.getQueryParameter("code");
                        String back = code != null ? "maktaba://auth?code=" + Uri.encode(code) : "maktaba://auth";
                        String html = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                            + "<title>Maktaba</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,sans-serif;"
                            + "background:#f6f4ef;color:#1d1c1a;text-align:center;padding:24px;box-sizing:border-box}"
                            + "@media(prefers-color-scheme:dark){body{background:#1d1914;color:#efe3cb}}"
                            + "a{display:inline-block;margin-top:12px;padding:14px 28px;border-radius:12px;background:#a3302a;color:#fff;font-weight:600;text-decoration:none}</style></head><body><main>"
                            + (code != null ? "<p><b>Signed in.</b><br>You can go back to Maktaba now.</p>" : "<p>The sign-in did not finish. Go back to Maktaba and try again.</p>")
                            + "<a href='" + back + "'>Back to Maktaba</a></main>"
                            + "<script>setTimeout(function(){location.href='" + back + "'},300)</script></body></html>";
                        byte[] body = html.getBytes("UTF-8");
                        OutputStream out = s.getOutputStream();
                        out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: " + body.length + "\r\n\r\n").getBytes("UTF-8"));
                        out.write(body);
                        out.flush();
                        if (code == null) continue;
                        // Hand the code to the app now, even before the reader switches back.
                        JSObject data = new JSObject();
                        data.put("url", back);
                        notifyListeners("authCallback", data, true);
                        break;
                    } catch (java.net.SocketTimeoutException e) {
                        break;
                    } catch (Exception e) {
                        if (server.isClosed()) break;
                    }
                }
            } finally {
                try { server.close(); } catch (Exception ignored) { }
                if (signInSocket == server) signInSocket = null;
            }
        }, "maktaba-signin").start();
    }

    private void stopSignInListener() {
        java.net.ServerSocket s = signInSocket;
        signInSocket = null;
        if (s != null) try { s.close(); } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ updating the app itself

    /** The installed version, and whether Maktaba may install updates (Android asks once). */
    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode);
            r.put("versionName", info.versionName);
        } catch (Exception e) {
            r.put("versionCode", 0);
        }
        r.put("canInstall", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    private static String signer(android.content.pm.PackageInfo info) {
        if (info == null) return null;
        try {
            android.content.pm.Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
                sigs = info.signingInfo.hasMultipleSigners() ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
            } else {
                sigs = info.signatures;
            }
            if (sigs == null || sigs.length == 0) return null;
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            return android.util.Base64.encodeToString(md.digest(sigs[sigs.length - 1].toByteArray()), android.util.Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static int sigFlag() {
        return Build.VERSION.SDK_INT >= 28 ? android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES : android.content.pm.PackageManager.GET_SIGNATURES;
    }

    private File updateFile() {
        File dir = new File(getContext().getCacheDir(), "update");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "maktaba-update.apk");
    }

    /**
     * Downloads a new version, reporting progress, and checks it is signed with the same key
     * as the installed app (otherwise Android would refuse to install it over this one).
     */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("Not a download address");
            return;
        }
        new Thread(() -> {
            File out = updateFile();
            File part = new File(out.getPath() + ".part");
            try {
                java.net.HttpURLConnection c = null;
                String at = url;
                // GitHub sends downloads on to its file servers: follow, staying on https.
                for (int hop = 0; hop < 6; hop++) {
                    c = (java.net.HttpURLConnection) new java.net.URL(at).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(60000);
                    c.setRequestProperty("Accept", "application/octet-stream");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String next = c.getHeaderField("Location");
                        c.disconnect();
                        if (next == null || !next.startsWith("https://")) throw new Exception("Bad redirect");
                        at = next;
                        continue;
                    }
                    if (code != 200) throw new Exception("The download answered " + code);
                    break;
                }
                long total = c.getContentLengthLong();
                long done = 0;
                long lastReport = 0;
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastReport > 300) {
                            lastReport = now;
                            JSObject p = new JSObject();
                            p.put("done", done);
                            p.put("total", total);
                            notifyListeners("updateProgress", p);
                        }
                    }
                }
                c.disconnect();
                if (total > 0 && done != total) throw new Exception("The download was cut short");
                if (out.exists()) out.delete();
                if (!part.renameTo(out)) throw new Exception("Could not save the download");
                android.content.pm.PackageManager pm = getContext().getPackageManager();
                android.content.pm.PackageInfo apk = pm.getPackageArchiveInfo(out.getPath(), sigFlag());
                if (apk == null || !getContext().getPackageName().equals(apk.packageName)) {
                    out.delete();
                    throw new Exception("The downloaded file is not Maktaba");
                }
                if (Build.VERSION.SDK_INT >= 28 && apk.applicationInfo != null) {
                    apk.applicationInfo.sourceDir = out.getPath();
                    apk.applicationInfo.publicSourceDir = out.getPath();
                }
                String mine = signer(pm.getPackageInfo(getContext().getPackageName(), sigFlag()));
                String theirs = signer(apk);
                JSObject r = new JSObject();
                r.put("sameKey", mine != null && mine.equals(theirs));
                r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? (int) apk.getLongVersionCode() : apk.versionCode);
                call.resolve(r);
            } catch (Exception e) {
                part.delete();
                call.reject("The update could not be downloaded: " + e.getMessage());
            }
        }, "maktaba-update").start();
    }

    /**
     * Opens the phone's security settings (on Samsung phones, where Auto Blocker is: it stops
     * every app that is not from the Play Store or Galaxy Store, Maktaba's updates included).
     */
    @PluginMethod
    public void openSecuritySettings(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(android.provider.Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        JSObject r = new JSObject();
        r.put("samsung", "samsung".equalsIgnoreCase(Build.MANUFACTURER));
        call.resolve(r);
    }

    /** Hands the downloaded update to Android's installer (asking for permission first if needed). */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        try {
            JSObject r = new JSObject();
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent allow = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(allow);
                r.put("needsPermission", true);
                call.resolve(r);
                return;
            }
            File apk = updateFile();
            if (!apk.exists()) {
                call.reject("Download the update first");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            r.put("needsPermission", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not open the installer: " + e.getMessage());
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
