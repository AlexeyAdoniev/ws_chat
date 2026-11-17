#!/bin/sh
set -eu

case "$CASSANDRA_DC" in
  ''|*[!a-zA-Z0-9_-]*)
    echo 'CASSANDRA_DC must contain only letters, numbers, underscores, or hyphens.' >&2
    exit 1
    ;;
esac

cqlsh cassandra-1 9042 -e "CREATE KEYSPACE IF NOT EXISTS ws_chat WITH replication = {'class': 'NetworkTopologyStrategy', '$CASSANDRA_DC': 2};"
