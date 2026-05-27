# AutoDatalia Deployment & TikTok Demo Guide

This guide is the operator-facing recipe. For the architecture rationale
(why Docker, why Caddy, why file-based storage) see
[`plans/hosting.md`](plans/hosting.md). Follow the steps in order,
copy-paste the commands, and you will have the app running in production
today.

---

## PART 1: Deploying the Server

### Step 1: Connect to your Server
Open your terminal (Mac) or PowerShell (Windows) and type:
```bash
ssh user@your-server-ip
```

### Step 2: Download the Code & Install Docker
Once you are logged into the server, paste these commands:
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Download the code (replace <your-org> with the real GitHub org)
git clone https://github.com/<your-org>/AutoDatalia.git ~/AutoDatalia
cd ~/AutoDatalia/infra
```

### Step 3: Configure the Passwords
Generate the two secrets first — humans pick bad ones:
```bash
echo "BACKEND_AUTH_TOKEN=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
```
Keep those two lines, you'll paste them into the env file in a moment.

Now create your production configuration file:
```bash
cp .env.production.example .env.production
nano .env.production
```
This will open a text editor. You only need to fill in these critical fields:
1. `API_DOMAIN=api.datalia.com` *(Do not include `https://`)*
2. `BACKEND_AUTH_TOKEN=<paste the value generated above>`
3. `JWT_SECRET=<paste the value generated above>`
4. `AI_API_KEY=sk-or-v1-...` *(Your OpenRouter key)*
5. Fill in your **Meta** and **TikTok** App IDs and Secrets.
*(Press `Ctrl+O`, `Enter`, then `Ctrl+X` to save and exit).*

### Step 4: Turn it On!
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
*Wait ~2 minutes. The backend is now live at `https://api.datalia.com`! Caddy will automatically secure it with HTTPS.*

---

## PART 2: Deploying the Frontend (Website)

Still on your server, run these commands to start the website:

```bash
cd ~/AutoDatalia/frontend

# Install dependencies (Node 20+ required)
npm install

# Create the config file
cat > .env.local << EOF
NEXT_PUBLIC_API_BASE_URL=https://api.datalia.com
NEXT_PUBLIC_BACKEND_AUTH_TOKEN=$(grep BACKEND_AUTH_TOKEN ~/AutoDatalia/infra/.env.production | cut -d= -f2-)
EOF

# Build and start the website
npm run build
npx pm2 start npm --name frontend -- start -- -p 3000
npx pm2 save && npx pm2 startup    # restart pm2 jobs after reboot
```
*Your website is now running 24/7!*

> ⚠️ **Note on `NEXT_PUBLIC_BACKEND_AUTH_TOKEN`:** any variable with the
> `NEXT_PUBLIC_` prefix is bundled into the client-side JS, so this
> bearer token is visible to anyone who loads the dashboard. Acceptable
> for an internal-only tool with a known user base; if the dashboard
> ever becomes public, switch to a proxy-based auth flow.

---

## PART 3: The Dev Portals

Now that your server is live at `https://api.datalia.com`, you must tell Meta and TikTok where it is.

**1. Go to Facebook Developers:**
- App Settings → Basic → App Domains: Add `api.datalia.com`
- Facebook Login → Settings → Valid OAuth Redirect URIs: Add `https://api.datalia.com/oauth/meta/callback`
- Instagram Login → Settings → Valid OAuth Redirect URIs: Add `https://api.datalia.com/oauth/instagram/callback`

**2. Go to TikTok Developers:**
- Configuration → Redirect URI: Add `https://api.datalia.com/oauth/tiktok/callback`
- Privacy Policy URL: Add `https://api.datalia.com/privacy`
- Terms of Service URL: Add `https://api.datalia.com/terms`

---

## PART 4: The TikTok Demo Recording

TikTok requires a screen recording of your app to approve it. Your recording **MUST** show these exact things:

1. **Login:** Click "Connect TikTok", log in, and return to the app.
2. **Privacy Selector:** Show that you can click the dropdown and choose (Public / Friends / Private).
3. **Checkboxes:** Click the "Promote third party" and "Promote yourself" checkboxes to prove they work.
4. **Music Checkbox:** Check the "My content doesn't use copyrighted music" box (Required!).
5. **Publish:** Hit publish, then open the real TikTok app/website to show the post actually appeared.

**⚠️ Do NOT do these things (or TikTok will reject you):**
- Do not add fake watermarks or logos to your demo video.
- Do not call the app a "cross-posting" tool. They want original creation tools.
- Do not say it's for "internal use only". 

---

## Common Glitches

- **"API 500 / Publish Failed"**: If you ever see this while developing on your laptop, it just means Docker Desktop lost its internet connection. Restart Docker. (This won't happen on your production server).
- **"Meta 324" or "photo_pull_failed"**: This happens when testing locally with Ngrok. It will disappear completely once you deploy to your production server (Step 1) because Meta can easily access your real domain.
- **Tokens Expiring**: If TikTok suddenly says "Access Token Invalid", just go to Settings, disconnect TikTok, and reconnect it.
