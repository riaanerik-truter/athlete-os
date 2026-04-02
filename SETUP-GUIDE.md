# Athlete OS — Setup Guide

## Getting your API keys and tokens

### Anthropic API Key (required)
Coach Ri runs on Anthropic's Claude. You need an API key to use it.

1. Go to console.anthropic.com
2. Create an account or sign in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key — it starts with sk-ant-
6. Paste it when the installer asks for it

Cost: You pay per message. Typical monthly cost is $1-5 depending
on how much you chat with Coach Ri. See the cost tracker in the
dashboard for your usage.

### Discord Bot Token (optional)
Allows Coach Ri to message you in Discord.

1. Go to discord.com/developers/applications
2. Click "New Application" — name it "Athlete OS Coach"
3. Click "Bot" in the left sidebar
4. Under "Privileged Gateway Intents" enable "Message Content Intent"
5. Click "Reset Token" and copy it
6. Go to "OAuth2" → "URL Generator"
7. Select scope: bot
8. Select permissions: Send Messages, Read Message History, Attach Files
9. Open the generated URL and add the bot to your Discord server
10. In your server, enable Developer Mode (User Settings → Advanced)
11. Create a channel called #coach
12. Right-click the channel → Copy Channel ID
13. Right-click your server → Copy Server ID (Guild ID)

### Strava API (optional)
Allows automatic daily sync of your activities from Strava.

1. Go to strava.com/settings/api
2. Create an application — name it "Athlete OS"
3. Copy the Client ID and Client Secret
4. The installer will open a browser for OAuth authorisation

---

## Keeping your keys safe

- Never share your API keys with anyone
- Never commit .env files to GitHub (the .gitignore handles this)
- If a key is accidentally exposed, regenerate it immediately:
  - Anthropic: console.anthropic.com → API Keys → Delete + Create new
  - Discord: discord.com/developers → Your app → Bot → Reset Token
- Store a backup of your keys in a password manager (1Password,
  Bitwarden, etc.) — not in a text file on your desktop

---

## Troubleshooting

### "Docker is not running"
Open Docker Desktop from the Start menu and wait for it to fully load
(the whale icon in the system tray stops animating).

### "Port 3000 is already in use"
Another process is using port 3000. Run: netstat -ano | findstr :3000
Then: taskkill /PID [pid] /F

### "Coach Ri is not responding"
Make sure all services are running. Open start-athlete-os and check
that all five terminal windows are open and show no errors.

### "Database connection failed"
Run: docker ps
If athleteos_db is not listed, run: docker start athleteos_db
