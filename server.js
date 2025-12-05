const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 儲存線上使用者
let users = {};

function generateName() {
    return "訪客-" + Math.floor(Math.random() * 1000);
}

io.on('connection', (socket) => {
  console.log('新連線: ' + socket.id);

  // 1. 初始化：接收位置回報
  socket.on('reportLocation', (coords) => {
    users[socket.id] = {
        id: socket.id,
        name: generateName(), // 預設給個隨機名字
        lat: coords.lat,
        lng: coords.lng
    };
    io.emit('updateMap', users);
    
    // 告訴該玩家他原本的名字是什麼 (方便前端顯示)
    socket.emit('yourNameIs', users[socket.id].name);

    io.emit('chatMessage', { 
        name: '系統', 
        text: `${users[socket.id].name} 已連線`,
        isSystem: true 
    });
  });

  // 2. 新增：玩家移動
  socket.on('playerMove', (coords) => {
    if (users[socket.id]) {
        users[socket.id].lat = coords.lat;
        users[socket.id].lng = coords.lng;
        // 廣播更新後的地圖位置
        io.emit('updateMap', users);
    }
  });

  // 3. 新增：玩家改名
  socket.on('changeName', (newName) => {
    if (users[socket.id]) {
        let oldName = users[socket.id].name;
        users[socket.id].name = newName; // 更新名字
        
        io.emit('updateMap', users); // 更新地圖上的標籤
        io.emit('chatMessage', {
            name: '系統',
            text: `${oldName} 改名為 ${newName}`,
            isSystem: true
        });
    }
  });

  // 4. 聊天
  socket.on('sendChat', (msg) => {
    if (users[socket.id]) {
        io.emit('chatMessage', {
            id: socket.id,
            name: users[socket.id].name,
            text: msg,
            isSystem: false
        });
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

// 使用雲端給的 Port，如果沒有就用 3000
const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`伺服器啟動: http://localhost:${port}`);
});