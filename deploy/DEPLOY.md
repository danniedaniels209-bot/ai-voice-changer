# Running on a free cloud GPU (Colab / Kaggle)

Your conversions run 20-40x faster on a free cloud GPU. This is **optional
and off by default** — the toggle lives in Settings → "Cloud GPU backend".
Your laptop stays the default; a cloud session is something you start when
you have videos to make and abandon when done.

## One-time preparation

1. **Build the frontend** (so the backend can serve the whole app from one URL):

   ```
   cd frontend
   npm run build
   ```

2. **Push the project to GitHub** (private repo is fine — you'll paste its
   URL into the notebook):

   ```
   cd ai-voice-changer
   git init
   git add .
   git commit -m "AI voice changer"
   ```
   Then create a repo on github.com and push. The included `.gitignore`
   keeps venvs, models, temp files, and exports out — the repo stays small.

## Starting a session

### Google Colab (easiest)
1. Go to colab.research.google.com → New notebook
2. Runtime → Change runtime type → **T4 GPU**
3. One cell (private repo: use a GitHub token in the URL):

   ```
   !git clone https://github.com/YOUR_USERNAME/ai-voice-changer.git
   %cd ai-voice-changer
   !python deploy/cloud_gpu_setup.py
   ```

4. Wait ~5 minutes. The cell prints a **Backend URL** and **Access token**.

### Kaggle (most free hours: 30/week)
1. kaggle.com → Create → Notebook
2. Settings panel: **Accelerator → GPU T4 x2**, **Internet → On**
   (internet requires a phone-verified account)
3. Same cell as Colab. Same output.

## Connecting the app

Open the app (either your local frontend, or the printed URL directly with
`/?token=...`), go to **Settings → Cloud GPU backend**:

- tick the checkbox
- paste the Backend URL and Access token
- the page reloads — every conversion now runs on the GPU

Untick the box any time to switch back to your own computer. The setting is
per-device and touches nothing else.

## What to expect

- First conversion of a session downloads the models (~6 GB) at datacenter
  speed — a few minutes, once per session.
- Chatterbox on a T4: seconds per sentence instead of minutes.
- Your videos upload to the session and exports download back through the
  browser (use the Download buttons — the cloud machine's disk vanishes
  when the session ends).
- Colab sessions end after ~90 min of inactivity or when the tab closes;
  Kaggle sessions run up to 12h. Nothing is lost except the session itself —
  next time, re-run the cell and paste the new URL/token.

## Security notes (personal use)

- The tunnel URL is public internet: the access token (fresh per session)
  is what keeps strangers out. Don't share it.
- The token travels as a header/cookie over HTTPS (cloudflare tunnel), so
  it is not exposed in transit.
