import WebSocket, { RawData } from 'ws';
import { ClientMessage, MESSAGE_TYPES, Message, PARTICIPANT_ACTIONS, Participant } from './chat.types';

const SERVER_URL = process.env.WS_URL ?? 'ws://localhost:8080';
const CHAT_ID = 'general';
const TIMEOUT_MS = 5_000;

interface ServerMessage {
  type: string;
  payload: unknown;
}

interface MessageUpdate {
  chatId: string;
  messages: Message[];
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(SERVER_URL);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Timed out waiting for server message')), TIMEOUT_MS);

    const onMessage = (data: RawData): void => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (message.type === MESSAGE_TYPES.ERROR) {
        finish(new Error(`Server error: ${JSON.stringify(message.payload)}`));
        return;
      }
      if (predicate(message)) finish(null, message);
    };
    const onClose = (): void => finish(new Error('WebSocket closed unexpectedly'));
    const finish = (error: Error | null, message?: ServerMessage): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      if (error) reject(error);
      else resolve(message!);
    };

    socket.on('message', onMessage);
    socket.once('close', onClose);
  });
}

async function sendAndWait(
  socket: WebSocket,
  request: ClientMessage,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const response = waitForMessage(socket, predicate);
  socket.send(JSON.stringify(request));
  return response;
}

async function login(socket: WebSocket, name: string, password: string): Promise<Participant> {
  const response = await sendAndWait(
    socket,
    { type: MESSAGE_TYPES.LOGIN, payload: { name, password } },
    (message) => message.type === MESSAGE_TYPES.LOGIN,
  );
  return response.payload as Participant;
}

async function main(): Promise<void> {
  const aliceSocket = await connect();
  let bobSocket: WebSocket | undefined;

  try {
    const alice = await login(aliceSocket, 'alice', 'alice-password');
    bobSocket = await connect();
    const bob = await login(bobSocket, 'bob', 'bob-password');
    console.log(`Logged in as ${alice.name} and ${bob.name}`);



    const bobAdded = waitForMessage(
      bobSocket,
      (message) => message.type === MESSAGE_TYPES.MESSAGE_UPDATES
        && (message.payload as MessageUpdate).chatId === CHAT_ID,
    );

    await sendAndWait(
      aliceSocket,
      {
        type: MESSAGE_TYPES.MODIFY_PARTICIPANTS,
        payload: { action: PARTICIPANT_ACTIONS.ADD, participantId: bob.id, chatId: CHAT_ID },
      },
      (message) => message.type === MESSAGE_TYPES.MODIFY_PARTICIPANTS,
    );
    await bobAdded;

    const content = `Hello Bob! ${new Date().toISOString()}`;
    const bobReceivedMessage = waitForMessage(
      bobSocket,
      (message) => {
        if (message.type !== MESSAGE_TYPES.MESSAGE_UPDATES) return false;
        const update = message.payload as MessageUpdate;
        return update.chatId === CHAT_ID
          && update.messages.some((item) => item.participantId === alice.id && item.content === content);
      },
    );

    aliceSocket.send(JSON.stringify({
      type: MESSAGE_TYPES.SEND_MESSAGE,
      payload: { content, chatId: CHAT_ID },
    } satisfies ClientMessage));

    const result = await bobReceivedMessage;
    console.log(`Bob received Alice's message: ${content}:${JSON.stringify(result.payload)}`);
  } finally {
    aliceSocket.close();
    bobSocket?.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
