const express = require('express');
const app = express();
const http = require('http');
const https = require('https');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');
// 記得確認 package.json 有 "open-graph-scraper": "5.2.3"
const ogs = require('open-graph-scraper');

const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- 1. 廣播中轉站 (Proxy) ---
app.get('/radio-proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    const adapter = targetUrl.startsWith('https') ? https : http;

    const proxyReq = adapter.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (stream) => {
        if (stream.statusCode === 301 || stream.statusCode === 302) {
            return res.redirect(stream.headers.location);
        }
        res.writeHead(stream.statusCode, stream.headers);
        stream.pipe(res);
    }).on('error', (err) => {
        console.error('Proxy Error:', err.message);
        res.end();
    });
});

// --- 資料儲存 ---
let users = {};
let messageHistory = []; 
const MAX_HISTORY = 50; 
const DATA_FILE = __dirname + '/history.json';

if (fs.existsSync(DATA_FILE)) {
    try { messageHistory = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (err) {}
}
function saveHistory() { fs.writeFile(DATA_FILE, JSON.stringify(messageHistory), (err) => {}); }
function generateName() { return "訪客-" + Math.floor(Math.random() * 1000); }

io.on('connection', (socket) => {
  socket.emit('history', messageHistory);

  // 玩家加入
  socket.on('reportLocation', (coords) => {
    users[socket.id] = { 
        id: socket.id, 
        name: generateName(), 
        lat: coords.lat, 
        lng: coords.lng 
    };
    io.emit('updateMap', users);
    socket.emit('yourNameIs', users[socket.id].name);
    io.emit('chatMessage', { name: '系統', text: `${users[socket.id].name} 已連線`, isSystem: true });
  });

  // 玩家移動
  socket.on('playerMove', (coords) => {
    if (users[socket.id]) {
        users[socket.id].lat = coords.lat;
        users[socket.id].lng = coords.lng;
        io.emit('updateMap', users);
    }
  });

  // 改名
  socket.on('changeName', (newName) => {
    if (users[socket.id]) {
        let oldName = users[socket.id].name;
        users[socket.id].name = newName;
        io.emit('updateMap', users);
        io.emit('chatMessage', { name: '系統', text: `${oldName} 改名為 ${newName}`, isSystem: true });
    }
  });

  // --- 2. 聊天 (含連結預覽) ---
  socket.on('sendChat', async (msg) => {
    if (users[socket.id]) {
        let previewData = null;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = msg.match(urlRegex);

        if (urls && urls.length > 0) {
            try {
                const { result } = await ogs({ url: urls[0], timeout: 2000 });
                if (result.ogImage && result.ogImage.url) {
                    previewData = {
                        title: result.ogTitle || "連結預覽",
                        image: result.ogImage.url,
                        url: urls[0]
                    };
                }
            } catch (err) { console.log("預覽失敗"); }
        }

        const msgData = { 
            id: socket.id, 
            name: users[socket.id].name, 
            text: msg, 
            preview: previewData,
            isSystem: false, 
            time: new Date().getTime() 
        };
        messageHistory.push(msgData);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        saveHistory();
        io.emit('chatMessage', msgData);
    }
  });

  // --- 3. 語音通話信令 (PeerJS) ---
  socket.on('join-voice', (peerId) => {
      socket.broadcast.emit('user-connected-voice', peerId);
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
        io.emit('chatMessage', { name: '系統', text: `${users[socket.id].name} 下線了`, isSystem: true });
        socket.broadcast.emit('user-disconnected-voice', socket.id); // 通知語音斷線
        delete users[socket.id];
        io.emit('updateMap', users);
    }
  });
});

server.listen(port, () => {
  console.log(`伺服器啟動: http://localhost:${port}`);
});