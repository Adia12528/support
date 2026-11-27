# Sunport

Sunport is a multiplayer game served by a Node.js server. The server hosts the game files in `public/` and relays multiplayer state and WebRTC voice signalling.

## Play

[Play Sunport on Render](https://support-d5wj.onrender.com)

## Deploy to Render

Render deploys this service from GitHub; you do not upload the ZIP or files directly to Render.

1. Create a GitHub repository and upload the contents of this project. The repository root should contain `render.yaml` and the `server/` folder. Inside `server/`, keep `server.js`, `package.json`, `package-lock.json`, and `public/index.html`. Do not upload `node_modules/`.
2. Commit the files to your repository.
3. In Render, choose **New + → Web Service** and connect your GitHub account if prompted.
4. Select the repository and configure:
   - **Runtime:** Node
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. In **Advanced**, set the health check path to `/health`. Set `MAX_PLAYERS` to `16` if it is not already configured.
6. Click **Create Web Service** and wait for the service status to become **Live**.
7. Open the `https://<your-service>.onrender.com` URL shown in Render. Visit `/health` on that URL to check the server; it should return JSON with `"ok": true`.

This must be a **Web Service**, not a Static Site: the Node.js server handles multiplayer connections over WebSockets. The included `render.yaml` already defines the service settings and `MAX_PLAYERS`, so you can also deploy it through Render's **Blueprint** flow.

### Optional: TURN relay for voice

Some mobile networks may need a TURN relay for voice connections. Add `TURN_URL`, `TURN_USER`, and `TURN_PASS` as environment variables in the Render service, using the values supplied by your TURN provider.

### Updating the game

Replace `server/public/index.html` in GitHub and commit the change. Render will redeploy the service from the updated repository.
