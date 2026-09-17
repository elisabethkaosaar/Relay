# Relay Screen Sharing

Relay is a browser-to-browser WebRTC sharing app. Each peer can share a screen or camera, optionally include computer audio and a microphone, and view the other peer in the live preview.

## Run locally

The project has no dependencies.

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

With Node.js:

```powershell
npm start
```

Open `http://localhost:5173` in two browser tabs. Use the same room code in both tabs, connect both peers, then choose Camera or start a screen share.

## Repository layout

- `index.html` - application markup
- `styles.css` - dark-pink responsive design
- `app.js` - WebRTC capture, signaling, room, consent, and PiP behavior
- `server.ps1` - dependency-free Windows development server
- `server.js` - Node.js development server

## Important deployment note

GitHub stores and shares this source code, but GitHub Pages cannot provide the real-time signaling needed by this app. A public multi-device deployment needs:

1. A hosted HTTPS frontend.
2. A signaling service accessible to both browsers.
3. HTTPS permission for screen, camera, and microphone capture.

The current local prototype uses `BroadcastChannel`, which works between tabs on the same browser origin. It is not a substitute for a public signaling server.
