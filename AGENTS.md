# AGENTS.md

This is a  Study project - KISS, YAGNI

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

## Web Socket Chat

Backend for online chat

## Core featues

- inital login with user name and password
- add users to chat rooms
- send messages to chat rooms
- see messages of chat participants in a right order


## Entities 

- Participant {name}
- Chat {name}
- ChatParticipant {participantId(index), chatId(secondaryIndex)}
- Message {content, participantId(index), createdAt} 

## API (Web Socket)

Client messages: 
    'login' {name, password}
    'sendMessage' {content, chatId}
    <!--  Ignore for now 'modifyParticipants' {action: 'add' | 'remove', participantId} -->

Server messages: 
    'messageUpdates' {chatId, message[]}
    <!-- Ignore for now 'participantsUpdates' {chatId, participant[]} -->


## Tests
no need for that now

## Coding Style

Use two-space indentation, single quotes, semicolons, and trailing commas in multiline constructs. Use PascalCase for classes/interfaces, camelCase for functions and variables, and ALL_CAPS for constants. Prefix booleans with is, has, can, or should; include units such as timeoutMs.

## Best Practices
Use const by default and never var; use strict equality. Keep functions small, avoid deeply nested control flow, and do not mutate inputs or use arguments. Keep code self-documenting, adding comments only for non-obvious decisions. Represent missing values explicitly under strict TypeScript options.

## Optimization Guidelines
Choose collections deliberately: use Map for dynamic dictionaries, Set for large or frequently queried collections, and arrays for short lists. Prefer fixed property access. Keep hot functions monomorphic with stable argument and return types, initialize object fields consistently, and reuse allocations only when ownership and correctness remain clear.

