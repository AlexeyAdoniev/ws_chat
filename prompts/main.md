Implement an online chat backend (web-socket). Core features and API
use ws library
use some cassandra driver to connect to db
seed db with one 3 users, one chat (with one user). Print seeded entities 
use in-memory mapping for user sockets (populate after auth)
no need for tests, input validation for now

sendMessage abstract flow: get Users Of chat -> create Message -> send message to authed clients using the in-memory mapping