import { scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable, BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Client, types } from 'cassandra-driver';
import { Message, PARTICIPANT_ACTIONS, Participant } from './chat.types';

const keyspace = process.env.CASSANDRA_KEYSPACE ?? 'ws_chat';

const participants = [
  { id: 'alice', name: 'alice', password: 'alice-password' },
  { id: 'bob', name: 'bob', password: 'bob-password' },
  { id: 'carol', name: 'carol', password: 'carol-password' },
];
const chat = { id: 'general', name: 'General' };
const membership = { participantId: 'alice', chatId: chat.id };

@Injectable()
export class DatabaseService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly database = new Client({
    contactPoints: (process.env.CASSANDRA_CONTACT_POINTS ?? '127.0.0.1').split(','),
    localDataCenter: process.env.CASSANDRA_LOCAL_DATACENTER ?? 'datacenter1',
    keyspace,
  });

  private execute(query: string, params: unknown[] = []) {
    return this.database.execute(query, params, { prepare: true });
  }

  private async getRows(query: string, params: unknown[]): Promise<types.Row[]> {
    const rows: types.Row[] = [];
    let pageState: string | undefined;
    do {
      const result = await this.database.execute(query, params, { prepare: true, pageState });
      rows.push(...result.rows);
      pageState = result.pageState;
    } while (pageState);
    return rows;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.initializeDatabase();
    } catch (error) {
      await this.database.shutdown();
      throw error;
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.database.shutdown();
  }

  private async initializeDatabase(): Promise<void> {
    await this.database.connect();
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
      await this.database.execute(statement);
    }
    for (const participant of participants) {
      await this.execute(
        'INSERT INTO participants (name, id, password_hash) VALUES (?, ?, ?) IF NOT EXISTS',
        [participant.name, participant.id, scryptSync(participant.password, participant.id, 64)],
      );
    }
    await this.execute('INSERT INTO chats (id, name) VALUES (?, ?) IF NOT EXISTS', [chat.id, chat.name]);
    await this.execute(
      'INSERT INTO chat_participants (participant_id, chat_id) VALUES (?, ?) IF NOT EXISTS',
      [membership.participantId, membership.chatId],
    );
    console.log('Seeded participants (demo credentials):', participants);
    console.log('Seeded chat:', chat);
    console.log('Seeded chat participant:', membership);
  }

  async authenticate(name: string, password: string): Promise<Participant> {
    const result = await this.execute('SELECT id, name, password_hash FROM participants WHERE name = ?', [name]);
    const participant = result.first();
    if (!participant || !timingSafeEqual(participant.password_hash, scryptSync(password, participant.id, 64))) {
      throw new Error('Invalid name or password');
    }
    return { id: participant.id, name: participant.name };
  }

  async getChatParticipants(chatId: string): Promise<string[]> {
    const rows = await this.getRows('SELECT participant_id FROM chat_participants WHERE chat_id = ?', [chatId]);
    return rows.map((row) => row.participant_id);
  }

  async getParticipantChats(participantId: string): Promise<string[]> {
    const rows = await this.getRows('SELECT chat_id FROM chat_participants WHERE participant_id = ?', [participantId]);
    return rows.map((row) => row.chat_id);
  }

  async modifyParticipant(action: typeof PARTICIPANT_ACTIONS[keyof typeof PARTICIPANT_ACTIONS], participantId: string, chatId: string): Promise<void> {
    if (action === PARTICIPANT_ACTIONS.ADD) {
      await this.execute('INSERT INTO chat_participants (participant_id, chat_id) VALUES (?, ?)', [participantId, chatId]);
      return;
    }
    await this.execute('DELETE FROM chat_participants WHERE participant_id = ? AND chat_id = ?', [participantId, chatId]);
  }

  private toMessage(row: { id: types.TimeUuid; content: string; participant_id: string; created_at: Date }): Message {
    return {
      id: row.id.toString(),
      content: row.content,
      participantId: row.participant_id,
      createdAt: row.created_at.toISOString(),
    };
  }

  async saveMessage(content: string, participantId: string, chatId: string): Promise<Message> {
    const id = types.TimeUuid.now();
    const createdAt = id.getDate();
    await this.execute(
      'INSERT INTO messages (chat_id, id, participant_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
      [chatId, id, participantId, content, createdAt],
    );
    return this.toMessage({ id, content, participant_id: participantId, created_at: createdAt });
  }

  async getMessages(chatId: string): Promise<Message[]> {
    const rows = await this.getRows('SELECT id, content, participant_id, created_at FROM messages WHERE chat_id = ?', [chatId]);
    return rows.map((row) => this.toMessage({
      id: row.id,
      content: row.content,
      participant_id: row.participant_id,
      created_at: row.created_at,
    }));
  }
}
