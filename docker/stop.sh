#!/bin/bash

echo "=== container stopping ==="
docker stop starcoin-faucet-worker
docker rm  starcoin-faucet-worker
echo "=== container stopped ==="