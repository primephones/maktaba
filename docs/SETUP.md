# Switching on the link, Google Drive sign-in and app updates

One-time steps that only the owner of the GitHub repository and of a Google account
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
   - **SHA-1 certificate fingerprint:** `D3:5E:25:C7:6F:86:74:24:A6:67:1C:C0:35:5A:8F:0E:9D:D1:27:45`
     (the app's signing key, see step 3).

The web app picks up the Client ID at its next build; the Android app needs nothing else
once step 6 is done.

## 3. One signing key, so updates install over the old version (done)

Android only installs an update over an existing app if both were signed with the same
key. Every build is now signed with one permanent key, kept in the repository
(`android/app/maktaba-release.keystore`, by the owner's choice). So each new version
installs over the last one and keeps the library, and the app can update itself: a popup
offers each new build, and **Settings › About** has **Check for updates**.

Builds before this key (build 38 and earlier) were each signed with a throwaway key. Moving
from one of those to a new build needs one fresh install: back up first (**Settings ›
Backup**, or have Google Drive connected), uninstall, install the new build, restore. The
update popup explains this when it happens. After that, every update is one tap.

- **SHA-1 fingerprint** (for step 2.6): `D3:5E:25:C7:6F:86:74:24:A6:67:1C:C0:35:5A:8F:0E:9D:D1:27:45`
- SHA-256: `69:0E:BF:D8:4F:B7:61:41:12:31:7F:97:27:7F:94:DA:78:4C:7E:C8:6C:BB:BC:40:99:3D:B6:FD:04:D0:F6:C8`

A key kept as GitHub secrets (`MAKTABA_KEYSTORE_B64` and `MAKTABA_KEYSTORE_PASSWORD`)
would take its place, but switching keys means one more fresh install, so leave it as is.

## 4. Stopping the "Run failed" emails

Builds no longer fail for the parts waiting on you (the website before step 1, the phone
emulator test) or for GitHub now and then refusing to publish a release. If you would
rather not get build emails at all: <https://github.com/settings/notifications> › **GitHub
Actions** › untick **Email** (or tick **Only notify for failed workflows**).
