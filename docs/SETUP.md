# Switching on the link, Google Drive sign-in and app updates

Three one-time steps that only the owner of the GitHub repository and of a Google account
can do. Nothing here costs money.

## 1. The link to share (GitHub Pages), about 1 minute

1. Open <https://github.com/primephones/maktaba/settings/pages>.
2. Under **Build and deployment › Source**, choose **GitHub Actions**.

From the next build on, the app is at **<https://primephones.github.io/maktaba/>**. That is
the link to send people (Settings › Share Maktaba sends it from inside the app).

Until this is done, that address shows GitHub's "404 There isn't a GitHub Pages site here".
The Android app does not need it: "Sign in with OpenRouter" comes straight back to the app,
and Share Maktaba sends the Android download instead until the web version is up.

## 2. "Connect Google Drive" (each person's own cloud), about 10 minutes

Google requires the app's owner to register the app once. After that, everyone signs in
with their own Google account and their own Drive.

1. Go to <https://console.cloud.google.com/> and create a project called **Maktaba**.
2. **APIs & Services › Library**: find **Google Drive API** and press **Enable**.
3. **Google Auth Platform** (or **OAuth consent screen**):
   - **Branding:** app name *Maktaba*, your support email.
   - **Audience:** *External*. Then press **Publish app** so it is *In production*, which
     lets anyone sign in, not only test users.
   - **Data access:** add the scope `.../auth/drive.file` ("See, edit, create and delete only
     the specific Google Drive files you use with this app"). Maktaba asks for nothing else.
     Google treats this as a non-sensitive scope, so no security review should be needed.
4. **Clients › Create client › Web application**:
   - **Authorized JavaScript origins:** `https://primephones.github.io`
   - Create it, and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. On GitHub, open <https://github.com/primephones/maktaba/settings/variables/actions>, choose
   **New repository variable**, name it `GOOGLE_CLIENT_ID`, and paste the Client ID as its
   value. (It is not a secret: every Google sign-in button on the web shows it.)
6. **Clients › Create client › Android** (for the Android app):
   - **Package name:** `za.co.primephones.maktaba`
   - **SHA-1 certificate fingerprint:** the fingerprint of the app's signing key (step 3
     below gives it).

The web app picks up the Client ID at its next build; the Android app needs nothing else
once step 6 is done.

## 3. One signing key, so updates install over the old version

Android only installs an update over an existing app if both were signed with the same
key. Without a stored key, each build is signed with a new throwaway key, and installing a
newer build means uninstalling first, which loses the library on that phone. Google
sign-in on Android also checks this key (step 2.6).

The key must stay private. It is kept as two **GitHub secrets**, which nobody can read back,
not even the owner:

- `MAKTABA_KEYSTORE_B64`: the key file, as text
- `MAKTABA_KEYSTORE_PASSWORD`: its password

Add them at <https://github.com/primephones/maktaba/settings/secrets/actions> (**New
repository secret**). Every build after that is signed with this key.
