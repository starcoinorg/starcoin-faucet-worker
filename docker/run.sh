#!/bin/bash
CURDIR=$(cd "$(dirname "$0")"; pwd)
docker run -d --name starcoin-faucet-worker \
    -e "STARCOIN_FAUCET_WORKER_MYSQL_HOST=${STARCOIN_FAUCET_WORKER_MYSQL_HOST}" \
    -e "STARCOIN_FAUCET_WORKER_MYSQL_PORT=${STARCOIN_FAUCET_WORKER_MYSQL_PORT}" \
    -e "STARCOIN_FAUCET_WORKER_MYSQL_USER=${STARCOIN_FAUCET_WORKER_MYSQL_USER}" \
    -e "STARCOIN_FAUCET_WORKER_MYSQL_PWD=${STARCOIN_FAUCET_WORKER_MYSQL_PWD}" \
    -e "STARCOIN_FAUCET_WORKER_MYSQL_DB=${STARCOIN_FAUCET_WORKER_MYSQL_DB}" \
    -e "STARCOIN_FAUCET_WORKER_SENDERS=${STARCOIN_FAUCET_WORKER_SENDERS}" \
    -e "STARCOIN_FAUCET_WORKER_EMAIL_SENDER=${STARCOIN_FAUCET_WORKER_EMAIL_SENDER}" \
    -e "STARCOIN_FAUCET_WORKER_EMAIL_SENDER_PWD=${STARCOIN_FAUCET_WORKER_EMAIL_SENDER_PWD}" \
    -e "STARCOIN_FAUCET_WORKER_EMAIL_RECEIVERS=${STARCOIN_FAUCET_WORKER_EMAIL_RECEIVERS}" \
    starcoin/starcoin-faucet-worker:latest

docker ps


