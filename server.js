const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// 使用 Render 的 Port 或預設 3000
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- 資料儲存區 ---
let users = {};
let messageHistory = []; // 1. 新增：用來存歷史訊息的陣列
const MAX_HISTORY = 50;  // 設定最多存 50 句，避免伺服器爆掉

function generateName() {
    return "訪客-" + Math.floor(Math.random() * 1000);
}

io.on('connection', (socket) => {
  console.log('新連線: ' + socket.id);

  // 2. 新增：一連線就馬上把「歷史訊息」傳給這個人
  socket.emit('history', messageHistory);

  // 接收位置回報
  socket.on('reportLocation', (coords) => {
    users[socket.id] = {
        id: socket.id,
        name: generateName(),
        lat: coords.lat,
        lng: coords.lng
    };
    io.emit('updateMap', users);
    socket.emit('yourNameIs', users[socket.id].name);

    // 系統公告也算一種訊息，但不一定要存入歷史紀錄，看你需求
    // 這裡我們簡單做：系統訊息不存歷史，只即時顯示
    io.emit('chatMessage', { 
        name: '系統', 
        text: `${users[socket.id].name} 已連線`,
        isSystem: true 
    });
  });

  socket.on('playerMove', (coords) => {
    if (users[socket.id]) {
        users[socket.id].lat = coords.lat;
        users[socket.id].lng = coords.lng;
        io.emit('updateMap', users);
    }
  });

  socket.on('changeName', (newName) => {
    if (users[socket.id]) {
        let oldName = users[socket.id].name;
        users[socket.id].name = newName;
        io.emit('updateMap', users);
        io.emit('chatMessage', {
            name: '系統',
            text: `${oldName} 改名為 ${newName}`,
            isSystem: true
        });
    }
  });

  // 3. 修改：處理聊天訊息
  socket.on('sendChat', (msg) => {
    if (users[socket.id]) {
        // 建立訊息物件
        const msgData = {
            id: socket.id,
            name: users[socket.id].name,
            text: msg,
            isSystem: false,
            time: new Date().getTime() // 紀錄時間 (選用)
        };

        // 存入歷史紀錄
        messageHistory.push(msgData);
        // 如果超過 50 句，就把最舊的刪掉
        if (messageHistory.length > MAX_HISTORY) {
            messageHistory.shift();
        }

        // 廣播給所有人
        io.emit('chatMessage', msgData);
    }
  });

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