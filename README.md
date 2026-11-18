# Web Socket Chat

A study backend using NestJS 11, strict TypeScript, Node.js 24, `ws`, and `cassandra-driver`. Cassandra stores participants, chats, membership, and messages. Redis Pub/Sub routes live updates between app instances through `ioredis`. A process-local `Map<participantId, Set<WebSocket>>` tracks authenticated connections, including multiple connections per user.

## Run

```sh
cp .env.example .env
docker compose up --build -d --wait --wait-timeout 600
curl http://localhost:8080/health
```

Compose starts two Cassandra nodes, initializes the `ws_chat` keyspace with replication factor 2, then starts Redis, three app instances, and nginx. Nginx sends each new HTTP or WebSocket connection to the app instance with the fewest active connections. Cassandra startup can take several minutes. Elasticsearch is commented out.

The app creates its tables and indexes before listening. Startup inserts three demo users, one chat, and one membership if absent, and prints them, including demo credentials:

| Participant ID / name | Password | Initial chat |
| --- | --- | --- |
| alice | alice-password | general |
| bob | bob-password | |
| carol | carol-password | |

The chat has ID `general` and name `General`. Passwords are stored as scrypt hashes. Existing users, chats, messages, and other memberships survive restarts; startup restores Alice's seeded membership if it was removed.

Connect to `ws://localhost:8080/` through nginx, or `ws://localhost:3000/` when running Node locally. `/health` reports that the HTTP server is running; it does not probe Cassandra on each request.

## WebSocket API

Every message is JSON with `type` and `payload` fields. Login first:

```json
{"type":"login","payload":{"name":"alice","password":"alice-password"}}
```

Successful login returns:

```json
{"type":"login","payload":{"id":"alice","name":"alice"}}
```

Login also sends a `messageUpdates` event with stored history for each joined chat, in ascending message order. Add or remove a participant using an authenticated chat member's connection:

```json
{"type":"modifyParticipants","payload":{"action":"add","participantId":"bob","chatId":"general"}}
{"type":"modifyParticipants","payload":{"action":"remove","participantId":"bob","chatId":"general"}}
```

The caller receives a `modifyParticipants` acknowledgement with the same payload. Added participants' authenticated sockets receive the chat history. There are no `participantsUpdates` events.

Send a message as a chat member:

```json
{"type":"sendMessage","payload":{"content":"Hello!","chatId":"general"}}
```

The server gets the chat's participants, saves the message in Cassandra, then publishes one update with the recipient IDs to Redis. Every app instance subscribes and forwards it to those participants' authenticated sockets in its local map, including the sender:

```json
{
  "type": "messageUpdates",
  "payload": {
    "chatId": "general",
    "messages": [
      {
        "id": "<timeuuid>",
        "content": "Hello!",
        "participantId": "alice",
        "createdAt": "2026-11-17T10:00:00.000Z"
      }
    ]
  }
}
```

Failures return `{"type":"error","payload":{"message":"..."}}`. Login and membership are enforced; request payload validation is omitted for this study project.

Operations are serialized within one server process so concurrent sends persist and broadcast in the same order. Messages are partitioned by chat and clustered by ascending time UUID. Membership is partitioned by participant, with a secondary index on chat ID. Disconnecting removes the socket from the map. App instances must share Cassandra and Redis. The request queue orders work within each instance. Concurrent writes across instances can arrive live in a different order than Cassandra history. Redis Pub/Sub carries live updates only. Clients can reload saved history by logging in again.

## Run Node locally

Run Redis and use an existing Cassandra keyspace, or start the services separately. Node startup creates tables but expects the keyspace to exist.

```sh
yarn install --frozen-lockfile
CASSANDRA_CONTACT_POINTS=127.0.0.1 CASSANDRA_LOCAL_DATACENTER=datacenter1 CASSANDRA_KEYSPACE=ws_chat REDIS_URL=redis://127.0.0.1:6379 yarn dev
```

`yarn dev` rebuilds and restarts when TypeScript source files change. For a compiled production run:

```sh
yarn build
yarn start
```

`yarn typecheck` checks TypeScript without emitting files. The Dockerfile compiles in a build stage and runs the compiled app with production dependencies.

`src/main.ts` boots Nest with its native WebSocket adapter. `AppModule` wires the health controller, chat gateway, and Cassandra service. The gateway handles raw messages to preserve the existing `{ type, payload }` protocol, including errors and the shared operation queue. Shutdown terminates sockets, drains queued operations, then closes Cassandra and Redis.

Connection defaults are shown above. `PORT` defaults to `3000`. Compose supplies its own database hostnames. Host port and cluster settings are documented in `.env.example`.

Named Docker volumes retain database data across restarts. `docker compose down -v` deletes that data.
