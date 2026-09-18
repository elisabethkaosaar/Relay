const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const port = Number(process.env.PORT) || 5173;
const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const rooms = new Map();

function frameWebSocketMessage(message) {
  const payload = Buffer.from(message);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function sendWebSocket(socket, data) {
  socket.write(frameWebSocketMessage(JSON.stringify(data)));
}

function removeSocket(socket) {
  const room = rooms.get(socket.room);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) rooms.delete(socket.room);
}

function handleWebSocketFrame(socket, frame) {
  let offset = 0;
  while (offset + 2 <= frame.length) {
    const first = frame[offset++];
    const second = frame[offset++];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    if (length === 126) { if (offset + 2 > frame.length) return; length = frame.readUInt16BE(offset); offset += 2; }
    if (length === 127) { if (offset + 8 > frame.length) return; length = Number(frame.readBigUInt64BE(offset)); offset += 8; }
    const masked = (second & 0x80) !== 0;
    if (masked) { if (offset + 4 > frame.length) return; var mask = frame.subarray(offset, offset + 4); offset += 4; }
    if (offset + length > frame.length) return;
    let payload = Buffer.from(frame.subarray(offset, offset + length));
    offset += length;
    if (masked) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    if (opcode === 0x8) { socket.end(); return; }
    if (opcode === 0x9) { socket.write(Buffer.from([0x8a, 0])); continue; }
    if (opcode !== 0x1) continue;
    let message;
    try { message = JSON.parse(payload.toString()); } catch { continue; }
    if (message.type === 'join') {
      socket.room = message.room;
      const room = rooms.get(socket.room) || new Set();
      room.add(socket);
      rooms.set(socket.room, room);
      continue;
    }
    const room = rooms.get(socket.room) || [];
    for (const peer of room) if (peer !== socket && !peer.destroyed) sendWebSocket(peer, message);
  }
}

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(request.url.split('?')[0]);
  const relativePath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.resolve(root, `.${relativePath}`);

  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(response);
});

server.on('upgrade', (request, socket) => {
  if (request.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  socket.buffer = Buffer.alloc(0);
  socket.on('data', chunk => { socket.buffer = Buffer.concat([socket.buffer, chunk]); handleWebSocketFrame(socket, socket.buffer); socket.buffer = Buffer.alloc(0); });
  socket.on('close', () => removeSocket(socket));
  socket.on('error', () => removeSocket(socket));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Relay is running on port ${port}`);
});
