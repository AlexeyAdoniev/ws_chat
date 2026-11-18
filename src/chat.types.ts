export interface Participant {
  id: string;
  name: string;
}

export interface Message {
  id: string;
  content: string;
  participantId: string;
  createdAt: string;
}

export const MESSAGE_TYPES = {
  LOGIN: 'login',
  SEND_MESSAGE: 'sendMessage',
  MODIFY_PARTICIPANTS: 'modifyParticipants',
  MESSAGE_UPDATES: 'messageUpdates',
  ERROR: 'error',
} as const;

export const PARTICIPANT_ACTIONS = {
  ADD: 'add',
  REMOVE: 'remove',
} as const;

export type ClientMessage =
  | { type: typeof MESSAGE_TYPES.LOGIN; payload: { name: string; password: string } }
  | { type: typeof MESSAGE_TYPES.SEND_MESSAGE; payload: { content: string; chatId: string } }
  | {
    type: typeof MESSAGE_TYPES.MODIFY_PARTICIPANTS;
    payload: { action: typeof PARTICIPANT_ACTIONS[keyof typeof PARTICIPANT_ACTIONS]; participantId: string; chatId: string };
  };
