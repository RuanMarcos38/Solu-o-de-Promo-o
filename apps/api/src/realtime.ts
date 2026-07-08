import { Server } from 'socket.io';

let io: Server | null = null;

export function setRealtimeServer(server: Server) {
  io = server;
}

export function emitNewOffers(offers: unknown[]) {
  if (!io) return;
  for (const offer of offers) io.emit('offer:new', offer);
}

export function emitStats(stats: unknown) {
  if (!io) return;
  io.emit('stats:update', stats);
}
