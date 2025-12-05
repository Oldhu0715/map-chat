const express = require('express');
const app = express();
const http = require('http');
const https = require('https'); // 引入 https 模組
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require('fs');

// 使用 Render 的 Port 或預設 3000
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- 🔥 廣播中轉站 (讓 HTTP 電台也能播) ---
// 當瀏覽器請求 /radio-proxy?url=... 時，伺服器幫忙去抓聲音並轉傳
app.get('/radio-proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    // 判斷目標是 http 還是 https
    const adapter = targetUrl.startsWith('https') ? https : http;

    // 模擬瀏覽器行為發送請求
    const proxyReq = adapter.get(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (stream) => {
        // 如果遇到 301/302 轉址，遞迴處理 (簡單版直接轉向)
        if (stream.statusCode === 301 || stream.statusCode === 302) {
            return res.redirect(stream.headers.location);
        }

        // 設定標頭，告訴瀏覽器這是音訊
        res.writeHead(stream.statusCode, stream.headers);
        
        // 把聲音流直接 "接管" 傳給瀏覽器
        stream.pipe(res);
    }).on('error', (err) => {
        console.error('Proxy Error:', err.message);
        res.end();
    });
});
// ----------------------------------------

// --- 資料儲存 (聊天紀錄) ---
let users = {};
let messageHistory = []; 
const MAX_HISTORY = 50; 
const DATA_FILE = __dirname + '/history.json';

// 啟動時讀取紀錄
if (fs.existsSync(DATA_FILE)) {
    try { messageHistory = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (err) {}
}

function saveHistory() { 
    fs.writeFile(DATA_FILE, JSON.stringify(messageHistory), (err) => {}); 
}

function generateName() { 
    return "訪客-" + Math.floor(Math.random() * 1000); 
}

io.on('connection', (socket) => {
  // 連線時傳送歷史紀錄
  socket.emit('history', messageHistory);

  // 1. 玩家回報位置 (加入遊戲)
  socket.on('reportLocation', (coords) => {
    users[socket.id] = { 
        id: socket.id, 
        name: generateName(), 
        lat: coords.lat, 
        lng: coords.lng 
    };
    io.emit('updateMap', users); // 更新給所有人
    socket.emit('yourNameIs', users[socket.id].name); // 告訴他自己的名字
    io.emit('chatMessage', { name: '系統', text: `${users[socket.id].name} 已連線`, isSystem: true });
  });

  // 2. 玩家移動
  socket.on('playerMove', (coords) => {
    if (users[socket.id]) {
        users[socket.id].lat = coords.lat;
        users[socket.id].lng = coords.lng;
        io.emit('updateMap', users);
    }
  });

  // 3. 改名
  socket.on('changeName', (newName) => {
    if (users[socket.id]) {
        let oldName = users[socket.id].name;
        users[socket.id].name = newName;
        io.emit('updateMap', users);
        io.emit('chatMessage', { name: '系統', text: `${oldName} 改名為 ${newName}`, isSystem: true });
    }
  });

  // 4. 聊天訊息
  socket.on('sendChat', (msg) => {
    if (users[socket.id]) {
        const msgData = { 
            id: socket.id, 
            name: users[socket.id].name, 
            text: msg, 
            isSystem: false, 
            time: new Date().getTime() 
        };
        messageHistory.push(msgData);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        saveHistory(); // 存檔
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