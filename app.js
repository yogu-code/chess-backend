import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import { initSocketServer } from './src/socket/socket.js'; 

dotenv.config();

const app = express();
const server = http.createServer(app);

initSocketServer(server); // Attach your socket setup

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
