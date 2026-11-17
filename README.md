# Web Socket Chat

Local prototype environment: Node.js 24 with Yarn, nginx, two Cassandra 5.0 nodes, Redis 8, and Elasticsearch.

Requires Docker Engine with Docker Compose v2. Allow roughly 6 GB of memory for the stack; Cassandra startup can take several minutes.

```sh
cp .env.example .env
docker compose up --build -d --wait --wait-timeout 600
curl http://localhost:8080/health
```

The health endpoint returns `{"status":"ok"}`. It checks the placeholder HTTP server only; database clients and chat features are not implemented yet. nginx forwards HTTP and supports future WebSocket upgrades. The app receives database connection settings through its environment.

| Service | Host address | Address inside Compose |
| --- | --- | --- |
| HTTP through nginx | localhost:8080 | app:3000 |
| Cassandra node 1 | localhost:9042 | cassandra-1:9042 |
| Cassandra node 2 | localhost:9043 | cassandra-2:9042 |
| Redis | localhost:6379 | redis:6379 |
| Elasticsearch | localhost:9200 | elasticsearch:9200 |

Configure host ports and database settings in `.env`. The two Cassandra nodes share a cluster and datacenter. Inspect membership with:

```sh
docker compose exec cassandra-1 nodetool status
```

Expect two nodes marked `UN` once both have joined. This environment uses unauthenticated databases, including Elasticsearch with security disabled, and binds published ports to localhost. It is intended for local development.

Elasticsearch may require increasing the Docker host's `vm.max_map_count` if its logs report a bootstrap check failure. See the [official Docker setup instructions](https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-docker-prod).

```sh
docker compose ps
docker compose logs -f
docker compose down
```

The `cassandra-init` service creates the `ws_chat` keyspace after both Cassandra nodes are healthy, using `NetworkTopologyStrategy` and replication factor 2 in `CASSANDRA_DC` (default: `datacenter1`). It exits after initialization and preserves an existing keyspace's configuration.

Named volumes retain database data across restarts. `docker compose down -v` deletes that data.

To run only the placeholder server locally with Node.js 24 and Yarn 1.22.22:

```sh
yarn install --frozen-lockfile
yarn dev
```

The local server listens on port 3000 by default; override it with `PORT`.
