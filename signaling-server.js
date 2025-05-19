// Simple WebRTC Signaling Server using Express and Socket.IO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.SIGNALING_PORT || 4000;

// Store users in rooms
const rooms = {};

io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);
    // Notify the joining user of the current user count
    io.to(socket.id).emit('user-count', rooms[roomId].length);
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('offer', ({ roomId, offer, to }) => {
    socket.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ roomId, answer, to }) => {
    socket.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ roomId, candidate, to }) => {
    socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        socket.to(roomId).emit('user-left', socket.id);
      }
    }
  });
});

app.get('/', (req, res) => {
  res.send('WebRTC Signaling Server Running');
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
