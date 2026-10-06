# Deploying so your phone can reach it

## Do I need to deploy?

Yes. The Android app (PWA or Capacitor APK) is only a client. Every trip, waypoint, photo and track lives in `server/data/` (`trails.sqlite` + `photos/`) on whichever machine runs `npm start`. For the phone to see the same data it must be able to open your server's URL.

Two things to know before choosing an option:

* **Offline downloads are per device.** The area you downloaded in your desktop browser lives in that browser's IndexedDB. On the phone you open the trip and press *Download* again; it takes a minute on Wi‑Fi.
* **HTTPS matters on Android, a domain does not.** Chrome on Android refuses GPS, the service worker and *Add to Home screen* on a plain `http://` address (anything other than `localhost`). You do not need to buy a domain to get HTTPS — Options 1 and 2 below get a trusted certificate for free. If you really want plain HTTP on a raw IP, Option 3 shows how to make the Capacitor APK work with it.

The options, cheapest and easiest first.

---

## Option 1 — Tailscale on the machine you already have (free, recommended)

Your laptop/desktop/Raspberry Pi keeps running the server; Tailscale gives it a stable address and a real HTTPS certificate with no port‑forwarding, no domain and no cloud bill. Both of you just install the Tailscale app.

1. Install Tailscale ([tailscale.com/download](https://tailscale.com/download)) on the machine with your data and run `tailscale up`. In the admin console → **DNS**, enable **MagicDNS** and **HTTPS Certificates**.
2. Build and run the app in production mode:

   ```bash
   npm run build
   ```

   In `.env` set:

   ```ini
   NODE_ENV=production
   SECURE_COOKIES=true
   TRUST_PROXY=true
   PORT=3000
   ```

   then `npm start` (see [Keeping it running](#keeping-it-running) for a service that survives reboots).
3. Pick how the phone reaches it:

   **Private (VPN):** `tailscale serve --bg 3000`
   Prints a URL like `https://my-laptop.tail1234.ts.net`. Install Tailscale on the phone, sign in with the same account, and open that URL. Your friend either gets invited into your tailnet (admin console → **Users** → *Invite*; the free plan allows 3 users) or you share the machine with them (**Machines** → *Share*).

   **Public (no VPN on the phones):** `tailscale funnel --bg 3000`
   Same URL, but reachable from anywhere on the internet. The first run prints a link to enable Funnel in the admin console. Only the login page is exposed; nothing else works without an account.

4. On the phone open the URL in Chrome and log in. Either *Add to Home screen* (PWA) or enter the URL in the APK's **Server address** field. Both work because the certificate is trusted.

Caveats: the machine has to be on and awake while you want to sync (disable sleep, or use a Pi/mini PC). Funnel has a modest bandwidth cap, which is fine here because map tiles come straight from the tile providers, not through your server.

---

## Option 2 — Cheap VPS with a raw IP (≈ £3–5 / month, HTTPS without a domain)

Any small Ubuntu VM works: Hetzner CX22, DigitalOcean Basic, or an Oracle Cloud *Always Free* ARM instance (£0). The trick for HTTPS is **sslip.io**: the hostname `203-0-113-10.sslip.io` automatically resolves to `203.0.113.10`, and Let's Encrypt will issue a certificate for it, so Caddy can terminate TLS with zero DNS setup.

On the server (Ubuntu 24.04, replace `203.0.113.10` with your IP throughout):

```bash
# Node 22, git, Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# App
sudo mkdir -p /opt/trails && sudo chown $USER /opt/trails
git clone <your repo url> /opt/trails
cd /opt/trails
npm ci
npm run build
cp .env.example .env    # then edit: same OWNER_*/FRIEND_* as on your laptop, plus the lines below
```

`.env` on the server:

```ini
NODE_ENV=production
SECURE_COOKIES=true
TRUST_PROXY=true
PORT=3000
DATA_DIR=./server/data
```

Caddy (`/etc/caddy/Caddyfile`):

```
203-0-113-10.sslip.io {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

Copy your data up (see [Moving your existing data](#moving-your-existing-data)), set up the [service](#keeping-it-running), then open `https://203-0-113-10.sslip.io` on the phone. Use that same URL in the APK's **Server address** field.

If Let's Encrypt refuses because sslip.io has hit a shared rate limit, use `203.0.113.10.nip.io` instead — it works identically.

Plain HTTP on the VPS (no Caddy, `SECURE_COOKIES=false`, `ufw allow 3000`) is also possible for the desktop planner, but then Android only works via Option 3.

---

## Option 3 — Plain HTTP on a raw IP, Capacitor APK only

Use this if you want `http://203.0.113.10:3000` or `http://192.168.1.20:3000` on your home network with no TLS at all. It does **not** work as a PWA (Chrome blocks GPS on insecure origins), but the APK uses the native location plugin and bundles its own assets, so it only needs to be allowed to talk to a cleartext server.

Server `.env`: `SECURE_COOKIES=false` (cookies marked secure are dropped over HTTP). Everything else as above.

Two one‑line changes to the Android build, then rebuild:

1. `web/capacitor.config.ts` — the web view runs on `https://localhost`, so calling an `http://` API is "mixed content":

   ```ts
   android: {
     allowMixedContent: true,
   },
   ```

2. `web/android/app/src/main/AndroidManifest.xml` — Android 9+ blocks cleartext by default:

   ```xml
   <application
       android:usesCleartextTraffic="true"
       ...>
   ```

```bash
npm run build -w web && npm run cap:sync -w web
```

Install the APK, enter `http://203.0.113.10:3000` as the server address and log in.

Be aware that your password and all trip data travel unencrypted. On your home LAN or over a Tailscale IP (`http://100.x.y.z:3000`, already WireGuard‑encrypted) that is fine; on a public VPS prefer Option 2.

---

## Moving your existing data

Your current trips are in `server/data/` next to the `.env` you created. To carry them to the server:

1. Stop the local server (`Ctrl‑C`), so SQLite is not mid‑write.
2. Copy the folder and keep the same account names:

   ```bash
   rsync -av server/data/ user@203.0.113.10:/opt/trails/server/data/
   ```

   (For Option 1 there is nothing to copy — the data is already on that machine.)
3. Use the same `OWNER_USERNAME` / `FRIEND_USERNAME` in the server's `.env`. User ids are stored in the database and are what trips and shares point at, so changing a username would create a new, empty user. Passwords are re‑applied from `.env` on every start, so you can change them freely.

Back up `server/data/` from time to time; it is the whole application state.

---

## Keeping it running

A systemd unit so the server starts on boot and restarts if it crashes (works on a VPS, a Pi, or a Linux laptop):

```ini
# /etc/systemd/system/trails.service
[Unit]
Description=Trails route planner
After=network.target

[Service]
WorkingDirectory=/opt/trails
ExecStart=/usr/bin/npm start
Restart=on-failure
User=ubuntu
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trails
journalctl -u trails -f        # logs
```

Adjust `WorkingDirectory` and `User` to match. On Windows or macOS, `pm2` (`npm i -g pm2 && pm2 start npm --name trails -- start && pm2 save && pm2 startup`) does the same job.

To update: `git pull && npm ci && npm run build && sudo systemctl restart trails`.

---

## Getting the APK onto the phone

If you have already run `npx cap add android` and `npm run cap:sync`:

* **With a USB cable:** `npm run cap:open -w web`, pick your phone in Android Studio's device dropdown (USB debugging enabled), press **Run ▶**.
* **Without Android Studio open:**

  ```bash
  cd web/android && ./gradlew assembleDebug
  # → web/android/app/build/outputs/apk/debug/app-debug.apk
  ```

  Copy the file to the phone (USB, Drive, email) and open it; allow *Install unknown apps* when prompted.

With Options 1 or 2 you can skip the APK entirely and use *Add to Home screen* in Chrome; the APK is only required for Option 3 or if you later add background tracking.

## Checking it works

From the phone's browser open `<your url>/api/health`. You should see `{"ok":true}`. If you get a certificate warning, the HTTPS setup is wrong (not the app); if nothing loads, it is a firewall/port issue. Then log in, open a trip, download it, turn on flight mode and confirm the map and route still open.
