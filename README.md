# GST Expert Analyzer v2.0 — Deployment Guide

## What Was Fixed in v2.0
- ✅ `index.html` moved to `public/` folder (was causing 404 on Render)
- ✅ Analyze button click handler fixed (was not triggering analysis)
- ✅ PDF download fixed for Unicode/Indian language reports
- ✅ Table markdown separator rows no longer render as bad HTML
- ✅ Render cold-start retries added (server status auto-retries 4 times)
- ✅ All errors shown inline — no more browser `alert()` popups
- ✅ Groq API auto-retries on failure (up to 2 retries)
- ✅ Scanned PDFs detected and given clear error message
- ✅ Added Kannada + Gujarati languages

---

## Project Structure
```
gst-expert-analyzer/
├── server.js          ← Node/Express backend
├── package.json
├── .env               ← YOUR GROQ API KEY (never commit this)
├── .gitignore
└── public/
    └── index.html     ← Frontend (MUST be in public/ folder)
```

---

## Step 1 — Get a FREE Groq API Key
1. Go to https://console.groq.com
2. Sign up (free — no credit card)
3. Click "API Keys" → "Create API Key"
4. Copy the key (starts with `gsk_...`)

---

## Step 2 — Set Up Locally (First Time)

```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/gst-expert-analyzer.git
cd gst-expert-analyzer

# Install dependencies
npm install

# Create your .env file
echo "GROQ_API_KEY=gsk_your_key_here" > .env

# Test locally
npm run dev
# Open http://localhost:3000
```

---

## Step 3 — Deploy to GitHub

```bash
# Inside your project folder:

# Initialize git (only first time)
git init
git remote add origin https://github.com/YOUR_USERNAME/gst-expert-analyzer.git

# Stage all files
git add .

# Commit
git commit -m "v2.0 - Fixed upload, button, PDF, table, UI redesign"

# Push to GitHub
git push origin main
```

> ⚠️ Make sure `.env` is in `.gitignore` — never push your API key to GitHub!

---

## Step 4 — Deploy on Render

### If you already have a Render service:
1. Go to https://dashboard.render.com
2. Open your service → **Manual Deploy** → **Deploy latest commit**
3. That's it — Render auto-detects the push and rebuilds

### First time on Render:
1. Go to https://render.com → New → **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Name:** gst-expert-analyzer
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. **Environment Variables** → Add:
   - Key: `GROQ_API_KEY`
   - Value: `gsk_your_actual_key_here`
5. Click **Create Web Service**

Render will build and deploy. Takes ~2 minutes.

---

## Step 5 — Verify It Works

After deploy, open your Render URL and check:
- Top right shows 🟢 AI Ready
- Upload a GST PDF
- Click "Generate Expert GST Report"
- See 13-section report

---

## Common Issues

| Problem | Fix |
|---|---|
| 404 on homepage | Make sure `index.html` is inside `public/` folder |
| Server Offline (red dot) | Render free tier sleeps — wait 30s, it auto-wakes |
| "AI service not configured" | GROQ_API_KEY not set in Render environment variables |
| "No readable text" error | PDF is a scanned image — needs a text-based PDF |
| Analysis times out | Groq API is slow — try again; auto-retries 2 times |

---

## Updating the App Later

```bash
# Make your code changes, then:
git add .
git commit -m "describe your change"
git push origin main
# Render auto-deploys on push (if auto-deploy is ON in settings)
```
