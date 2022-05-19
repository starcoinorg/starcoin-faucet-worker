# Add environment variables

```
export STARCOIN_FAUCET_WORKER_MYSQL_HOST=localhost
export STARCOIN_FAUCET_WORKER_MYSQL_PORT=3306
export STARCOIN_FAUCET_WORKER_MYSQL_USER=
export STARCOIN_FAUCET_WORKER_MYSQL_PWD=
export STARCOIN_FAUCET_WORKER_MYSQL_DB=
export STARCOIN_FAUCET_WORKER_SENDERS=[{\"address\":xxx\"\",\"privateKey\":\"xxx\"},{\"address\":yyy\"\",\"privateKey\":\"yyy\"}]
```

# Install

```
yarn install
```

or

```
npm install
```

# How to use

1. Normally, we can batch transfer 5 new records each time with 1 sender.

```
node index.js --senderIndex=0 --count=5
```

2. In emergency conditions(eg. thousands of new records were added on the promotion day), we can batch handle them in parrael using multi senders.

```
node index.js --senderIndex=0 --count=50

node index.js --senderIndex=1 --count=50

...

```
