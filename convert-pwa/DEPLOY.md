# Ship tonight — Railway + Vercel

Two boxes:

- **Vercel** = the PWA (static frontend). Serves `index.html`, `css/`, `js/`, icons.
- **Railway** = the LibreOffice conversion API (`server/`). Makes Office→PDF exact.

The frontend works **without** the server (in-browser, best-effort). The server just
upgrades the PDF/Word routes to faithful output. So you can deploy either first —
but deploying Railway first means you only redeploy Vercel once.

---

## 1. Railway (the conversion API)

The `server/` folder is a self-contained Docker service. Railway auto-detects the
Dockerfile.

**Option A — CLI**
```bash
cd server
railway login
railway init          # create a new project
railway up            # builds the Docker image and deploys
```

**Option B — GitHub**
Push the repo, then in Railway: New Project → Deploy from GitHub → pick the repo and
set the **root directory** to `server`. It builds from the Dockerfile automatically.

Then:
1. In the service's **Settings → Networking**, click **Generate Domain**. Copy the URL
   (e.g. `https://reformat-server-production.up.railway.app`).
2. In **Variables**, optionally set `ALLOW_ORIGIN` to your Vercel URL once you have it
   (start with `*` to test, tighten later).
3. Sanity check: open `https://<your-railway-url>/health` → should return `{"ok":true}`.

Notes:
- The image includes LibreOffice + fonts, so the first build takes a few minutes and
  the image is ~700 MB — normal.
- The first conversion after a cold start is slow (LibreOffice warming up); subsequent
  ones are fast.
- Upload cap is 30 MB (change in `server/server.js`).

---

## 2. Vercel (the PWA)

Deploy the **`convert-pwa` root** (the `.vercelignore` keeps `server/` and docs out).

**CLI**
```bash
cd convert-pwa      # the folder that contains index.html
vercel              # preview deploy — accept the defaults, framework = "Other"
vercel --prod       # production
```

Or import the repo in the Vercel dashboard and set the project root to `convert-pwa`.
There's no build step — it's static.

---

## 3. Connect the two

1. Open `js/config.js` and paste your Railway URL:
   ```js
   window.APP_CONFIG = {
     convertApi: "https://reformat-server-production.up.railway.app",
   };
   ```
2. Redeploy the frontend:
   ```bash
   vercel --prod
   ```
3. (Recommended) Set `ALLOW_ORIGIN` on Railway to your exact Vercel domain and redeploy
   the service.

Done. Now `Word → PDF` routes through LibreOffice and comes out exact; the *approx*
badge disappears for that route. If Railway is ever down, the app silently falls back
to the in-browser converter, so it never hard-fails.

---

## Adding more server routes

LibreOffice converts far more than Word. To expose, say, **xlsx → pdf** or
**pptx → pdf**:

1. In `js/converters.js`, add the target under that input's `ROUTES` entry, pointing its
   `fn` at `serverConvert.bind(null, ...)` (or wrap like `docxToPdf` does) and add the
   route to `SERVER_ROUTES`.
2. No server change needed — `/convert?to=pdf` already accepts any format LibreOffice
   can open.

## Cost / scaling notes

- Railway bills for the running container; a hobby instance is fine for personal use.
- LibreOffice is single-document-at-a-time per process. Each request uses an isolated
  profile so parallel requests won't corrupt each other, but heavy concurrency will
  queue. For real volume, run multiple replicas or put a queue in front.
