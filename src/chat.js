import WebSocket, { WebSocketServer } from 'ws';
import {
  authenticate,
  getChatParticipants,
  getParticipantChats,
  getMessages,
  modifyParticipant,
  saveMessage,
} from './database.js';

export function createChatServer(server) {
  const webSocketServer = new WebSocketServer({ server });
  const userSockets = new Map();
  // One queue keeps writes, history reads, membership changes, and broadcasts ordered.
  let pending = Promise.resolve();

  function send(socket, type, payload) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
    }
  }

  function detach(socket, participantId) {
    const sockets = userSockets.get(participantId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) userSockets.delete(participantId);
  }

  function broadcast(participantIds, type, payload) {
    for (const participantId of participantIds) {
      for (const socket of userSockets.get(participantId) ?? []) {
        send(socket, type, payload);
      }
    }
  }

  webSocketServer.on('connection', (socket) => {
    let participant = null;

    async function handleMessage(data) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const { type, payload } = JSON.parse(data.toString());
      if (type === 'login') {
        const authenticated = await authenticate(payload.name, payload.password);
        if (socket.readyState !== WebSocket.OPEN) return;
        detach(socket, participant?.id);
        participant = authenticated;
        if (!userSockets.has(participant.id)) {
          userSockets.set(participant.id, new Set());
          console.log('authed', participant.id);
        }
        userSockets.get(participant.id).add(socket);
        send(socket, 'login', participant);
        for (const chatId of await getParticipantChats(participant.id)) {
          send(socket, 'messageUpdates', { chatId, messages: await getMessages(chatId) });
        }
        return;
      }
      if (!participant) throw new Error('Login required');
      const participantIds = await getChatParticipants(payload.chatId);
      if (!participantIds.includes(participant.id)) throw new Error('Chat membership required');

      if (type === 'sendMessage') {
        const message = await saveMessage(payload.content, participant.id, payload.chatId);
        broadcast(participantIds, 'messageUpdates', { chatId: payload.chatId, messages: [message] });
        return;
      }
      if (type === 'modifyParticipants') {
        await modifyParticipant(payload.action, payload.participantId, payload.chatId);
        send(socket, 'modifyParticipants', payload);
        if (payload.action === 'add') {
          broadcast([payload.participantId], 'messageUpdates', {
            chatId: payload.chatId,
            messages: await getMessages(payload.chatId),
          });
        }
        return;
      }
      throw new Error('Unknown message type');
    }

    socket.on('message', (data) => {
      pending = pending.then(() => handleMessage(data)).catch((error) => {
        console.error('Chat request failed:', error);
        send(socket, 'error', { message: error.message });
      });
    });
    socket.on('close', () => detach(socket, participant?.id));
    socket.on('error', (error) => console.error('WebSocket error:', error));
  });

  return { webSocketServer, drain: () => pending };
}
