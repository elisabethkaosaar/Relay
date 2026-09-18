# Relay Screen Sharing

Relay is a browser-to-browser WebRTC sharing app. Each peer can share a screen or camera, optionally include computer audio and a microphone, and view the other peer in the live preview.

## Run locally

The project has no dependencies.

For a single computer, Windows PowerShell can serve the static page:

```powershell
powershell -ExecutionPolicy Bypass -File .\server.ps1
```

With Node.js:

```powershell
npm start
```

For sharing between computers, run the Node server instead:

```powershell
npm start
```

The Node server includes the WebSocket signaling relay. Open the server's HTTPS URL on both devices, use the same room code, connect both peers, then choose Camera or start a screen share. Camera and screen permissions require HTTPS on non-localhost devices.

### Phone and computer

Deploy `server.js` to an HTTPS Node host, then open the resulting `https://...` URL on both the computer and phone. Use the same room code on both devices. The WebSocket relay uses the page host automatically, so no separate signaling URL is needed.

A plain LAN address such as `http://192.168.1.20:5173` may load the page, but mobile browsers will block camera, microphone, and screen permissions. Use HTTPS for real device testing.

## Repository layout

- `index.html` - application markup
- `styles.css` - dark-pink responsive design
- `app.js` - WebRTC capture, signaling, room, consent, and PiP behavior
- `server.ps1` - static Windows development server for one computer
- `server.js` - Node.js development server and cross-device WebSocket signaling relay

## Important deployment note

GitHub stores and shares this source code, but GitHub Pages cannot provide the real-time signaling needed by this app. A public multi-device deployment needs:

1. A hosted HTTPS frontend.
2. The `server.js` WebSocket signaling service accessible to both browsers.
3. HTTPS permission for screen, camera, and microphone capture.

The browser now uses the WebSocket relay provided by `server.js`. GitHub Pages alone cannot run that relay, so deploy the Node server to a host that provides HTTPS and WebSocket support.
