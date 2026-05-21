# Reblas Dashboard - Local Server Production Setup (Autostart + Domain)

This keeps your current project for development and adds a separate always-on production instance on the same server.

## 1) Build the production app

```bash
cd /projects/reblas-crew-dashboard
npm install
npm run build
```

## 2) Install and enable systemd services

```bash
sudo cp deploy/systemd/reblas-dashboard-web.service /etc/systemd/system/
sudo cp deploy/systemd/reblas-dashboard-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now reblas-dashboard-web
sudo systemctl enable --now reblas-dashboard-bot
```

Check status/logs:

```bash
sudo systemctl status reblas-dashboard-web reblas-dashboard-bot
journalctl -u reblas-dashboard-web -f
journalctl -u reblas-dashboard-bot -f
```

## 3) Configure Nginx for reblasmafia.win

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx/reblasmafia.win.conf /etc/nginx/sites-available/reblasmafia.win.conf
sudo ln -sf /etc/nginx/sites-available/reblasmafia.win.conf /etc/nginx/sites-enabled/reblasmafia.win.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 4) Enable HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d reblasmafia.win -d www.reblasmafia.win
```

## 5) DNS requirements

At your DNS provider, point:
- `reblasmafia.win` A record -> your server public IP
- `www.reblasmafia.win` A record -> your server public IP

## 6) Deploy update flow (future changes)

```bash
cd /projects/reblas-crew-dashboard
git pull origin main
npm install
npm run build
sudo systemctl restart reblas-dashboard-web reblas-dashboard-bot
```

## Notes

- Web runs on local `127.0.0.1:3020`; Nginx is public entrypoint.
- Bot runs as a separate autostart service.
- Production builds are written to `.next-live`; development uses `.next-dev` so the two services do not overwrite each other.
- Development workflow is unchanged (`npm run dev`).
- If you use a different Linux user or path, update `User`, `Group`, and `WorkingDirectory` in both service files.
