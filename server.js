const express = require('express');
const app = express();
const http = require('http');
const https = require('https');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');

const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- 🔥 廣播中轉站 ---
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

  // 1. 玩家加入
  socket.on('reportLocation', (data) => {
    // data 包含 { lat, lng, avatar(選填) }
    users[socket.id] = { 
        id: socket.id, 
        name: generateName(), 
        avatar: data.avatar || "", // 預設空字串
        lat: data.lat, 
        lng: data.lng 
    };
    io.emit('updateMap', users);
    socket.emit('yourNameIs', users[socket.id].name);
    io.emit('chatMessage', { name: '系統', text: `${users[socket.id].name} 已連線`, isSystem: true });
  });

  // 2. 移動
  socket.on('playerMove', (coords) => {
    if (users[socket.id]) {
        users[socket.id].lat = coords.lat;
        users[socket.id].lng = coords.lng;
        io.emit('updateMap', users);
    }
  });

  // 3. 更新個人資料 (名字 + 頭像)
  socket.on('updateProfile', (data) => {
    if (users[socket.id]) {
        let oldName = users[socket.id].name;
        // 更新名字
        if (data.name) users[socket.id].name = data.name;
        // 更新頭像 (如果有傳的話)
        if (data.avatar !== undefined) users[socket.id].avatar = data.avatar;

        io.emit('updateMap', users);
        
        // 如果名字有變，廣播一下
        if (data.name && data.name !== oldName) {
            io.emit('chatMessage', { name: '系統', text: `${oldName} 改名為 ${data.name}`, isSystem: true });
        }
    }
  });

  // 4. 聊天
  socket.on('sendChat', (msg) => {
    if (users[socket.id]) {
        const msgData = { 
            id: socket.id, 
            name: users[socket.id].name, 
            avatar: users[socket.id].avatar, // 聊天紀錄也帶上頭像
            text: msg, 
            isSystem: false, 
            time: new Date().getTime() 
        };
        messageHistory.push(msgData);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        saveHistory();
        io.emit('chatMessage', msgData);
    }
  });

  // 5. 斷線
  socket.on('disconnect', () => {
    if (users[socket.id]) {
        io.emit('chatMessage', { name: '系統', text: `${users[socket.id].name} 下線了`, isSystem: true });
        delete users[socket.id];
        io.emit('updateMap', users);
    }
  });
});

server.listen(port, () => {
  console.log(`伺服器啟動: http://localhost:${port}`);
});