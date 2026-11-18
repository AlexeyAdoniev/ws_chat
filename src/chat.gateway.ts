import { Readable } from 'node:stream';
import { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import WebSocket, { RawData, WebSocketServer as WsServer } from 'ws';
import { ChatPubSubService, ChatUpdate } from './chat-pub-sub.service';
import { DatabaseService } from './database.service';
import { ClientMessage, MESSAGE_TYPES, PARTICIPANT_ACTIONS, Participant } from './chat.types';

interface QueuedRequest {
  socket: WebSocket;
  handle: () => Promise<void>;
}

@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection, OnApplicationBootstrap, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: WsServer;

  constructor(
    private readonly database: DatabaseService,
    private readonly chatPubSub: ChatPubSubService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.chatPubSub.subscribe((update) => this.broadcast(update));
  }

  private readonly userSockets = new Map<string, Set<WebSocket>>();
  // One queue keeps writes, history reads, membership changes, and broadcasts ordered.
  private readonly requests = new Readable({ objectMode: true, read() {} });
  private readonly processing = this.processRequests();
  private isShuttingDown = false;

  private async processRequests(): Promise<void> {
    for await (const item of this.requests) {
      const request = item as QueuedRequest;
      try {
        await request.handle();
      } catch (error) {
        console.error('Chat request failed:', error);
        this.send(request.socket, MESSAGE_TYPES.ERROR, {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private send(socket: WebSocket, type: string, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
    }
  }

  private detach(socket: WebSocket, participantId: string | undefined): void {
    if (participantId === undefined) return;
    const sockets = this.userSockets.get(participantId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) this.userSockets.delete(participantId);
  }

  private broadcast({ participantIds, chatId, messages }: ChatUpdate): void {
    for (const participantId of participantIds) {
      for (const socket of this.userSockets.get(participantId) ?? []) {
        this.send(socket, MESSAGE_TYPES.MESSAGE_UPDATES, { chatId, messages });
      }
    }
  }

  handleConnection(socket: WebSocket): void {
    if (this.isShuttingDown) {
      socket.terminate();
      return;
    }
    let participant: Participant | null = null;

    const handleMessage = async (data: RawData): Promise<void> => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const request = JSON.parse(data.toString()) as ClientMessage;
      if (request.type === MESSAGE_TYPES.LOGIN) {
        const { payload } = request;
        const authenticated = await this.database.authenticate(payload.name, payload.password);
        if (socket.readyState !== WebSocket.OPEN) return;
        this.detach(socket, participant?.id);
        participant = authenticated;
        if (!this.userSockets.has(participant.id)) {
          this.userSockets.set(participant.id, new Set());
          console.log('authed', participant.id);
        }
        this.userSockets.get(participant.id)!.add(socket);
        this.send(socket, MESSAGE_TYPES.LOGIN, participant);
        for (const chatId of await this.database.getParticipantChats(participant.id)) {
          this.send(socket, MESSAGE_TYPES.MESSAGE_UPDATES, { chatId, messages: await this.database.getMessages(chatId) });
        }
        return;
      }
      if (!participant) throw new Error('Login required');
      const { payload } = request;
      const participantIds = await this.database.getChatParticipants(payload.chatId);
      if (!participantIds.includes(participant.id)) throw new Error('Chat membership required');

      if (request.type === MESSAGE_TYPES.SEND_MESSAGE) {
        const { payload } = request;
        const message = await this.database.saveMessage(payload.content, participant.id, payload.chatId);
        await this.chatPubSub.publish({ participantIds, chatId: payload.chatId, messages: [message] });
        return;
      }
      if (request.type === MESSAGE_TYPES.MODIFY_PARTICIPANTS) {
        const { payload } = request;
        await this.database.modifyParticipant(payload.action, payload.participantId, payload.chatId);
        this.send(socket, MESSAGE_TYPES.MODIFY_PARTICIPANTS, payload);
        if (payload.action === PARTICIPANT_ACTIONS.ADD) {
          await this.chatPubSub.publish({
            participantIds: [payload.participantId],
            chatId: payload.chatId,
            messages: await this.database.getMessages(payload.chatId),
          });
        }
        return;
      }
      throw new Error('Unknown message type');
    };

    socket.on('message', (data) => {
      if (this.isShuttingDown) return;
      this.requests.push({ socket, handle: () => handleMessage(data) } satisfies QueuedRequest);
    });
    socket.on('close', () => this.detach(socket, participant?.id));
    socket.on('error', (error) => console.error('WebSocket error:', error));
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    for (const socket of this.server.clients) socket.terminate();
    this.requests.push(null);
    await this.processing;
  }
}
