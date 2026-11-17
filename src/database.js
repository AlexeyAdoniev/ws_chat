import { scryptSync, timingSafeEqual } from 'node:crypto';
import cassandra from 'cassandra-driver';

const { Client, types } = cassandra;
const keyspace = process.env.CASSANDRA_KEYSPACE ?? 'ws_chat';

export const database = new Client({
  contactPoints: (process.env.CASSANDRA_CONTACT_POINTS ?? '127.0.0.1').split(','),
  localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER ?? 'datacenter1',
  keyspace,
});

const participants = [
  { id: 'alice', name: 'alice', password: 'alice-password' },
  { id: 'bob', name: 'bob', password: 'bob-password' },
  { id: 'carol', name: 'carol', password: 'carol-password' },
];
const chat = { id: 'general', name: 'General' };
const membership = { participantId: 'alice', chatId: chat.id };

function execute(query, params = []) {
  return database.execute(query, params, { prepare: true });
}

async function getRows(query, params) {
  const rows = [];
  let pageState = null;
  do {
    const result = await database.execute(query, params, { prepare: true, pageState });
    rows.push(...result.rows);
    pageState = result.pageState;
  } while (pageState);
  return rows;
}

export async function initializeDatabase() {
  await database.connect();
  const statements = [
    `CREATE TABLE IF NOT EXISTS participants (
      name text PRIMARY KEY, id text, password_hash blob
    )`,
    `CREATE TABLE IF NOT EXISTS chats (
      id text PRIMARY KEY, name text
    )`,
    `CREATE TABLE IF NOT EXISTS chat_participants (
      participant_id text, chat_id text, PRIMARY KEY (participant_id, chat_id)
    )`,
    'CREATE INDEX IF NOT EXISTS chat_participants_chat_id ON chat_participants (chat_id)',
    `CREATE TABLE IF NOT EXISTS messages (
      chat_id text, id timeuuid, participant_id text, content text,
      created_at timestamp, PRIMARY KEY (chat_id, id)
    ) WITH CLUSTERING ORDER BY (id ASC)`,
    'CREATE INDEX IF NOT EXISTS messages_participant_id ON messages (participant_id)',
  ];
  for (const statement of statements) {
    await database.execute(statement);
  }
  for (const participant of participants) {
    await execute(
      'INSERT INTO participants (name, id, password_hash) VALUES (?, ?, ?) IF NOT EXISTS',
      [participant.name, participant.id, scryptSync(participant.password, participant.id, 64)],
    );
  }
  await execute('INSERT INTO chats (id, name) VALUES (?, ?) IF NOT EXISTS', [chat.id, chat.name]);
  await execute(
    'INSERT INTO chat_participants (participant_id, chat_id) VALUES (?, ?) IF NOT EXISTS',
    [membership.participantId, membership.chatId],
  );
  console.log('Seeded participants (demo credentials):', participants);
  console.log('Seeded chat:', chat);
  console.log('Seeded chat participant:', membership);
}

export async function authenticate(name, password) {
  const result = await execute('SELECT id, name, password_hash FROM participants WHERE name = ?', [name]);
  const participant = result.first();
  if (!participant || !timingSafeEqual(participant.password_hash, scryptSync(password, participant.id, 64))) {
    throw new Error('Invalid name or password');
  }
  return { id: participant.id, name: participant.name };
}

export async function getChatParticipants(chatId) {
  const rows = await getRows('SELECT participant_id FROM chat_participants WHERE chat_id = ?', [chatId]);
  return rows.map((row) => row.participant_id);
}

export async function getParticipantChats(participantId) {
  const rows = await getRows('SELECT chat_id FROM chat_participants WHERE participant_id = ?', [participantId]);
  return rows.map((row) => row.chat_id);
}

export async function modifyParticipant(action, participantId, chatId) {
  if (action === 'add') {
    await execute('INSERT INTO chat_participants (participant_id, chat_id) VALUES (?, ?)', [participantId, chatId]);
    return;
  }
  await execute('DELETE FROM chat_participants WHERE participant_id = ? AND chat_id = ?', [participantId, chatId]);
}

function toMessage(row) {
  return {
    id: row.id.toString(),
    content: row.content,
    participantId: row.participant_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function saveMessage(content, participantId, chatId) {
  const id = types.TimeUuid.now();
  const createdAt = id.getDate();
  await execute(
    'INSERT INTO messages (chat_id, id, participant_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [chatId, id, participantId, content, createdAt],
  );
  return toMessage({ id, content, participant_id: participantId, created_at: createdAt });
}

export async function getMessages(chatId) {
  const rows = await getRows('SELECT id, content, participant_id, created_at FROM messages WHERE chat_id = ?', [chatId]);
  return rows.map(toMessage);
}
