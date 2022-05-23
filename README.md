# Add environment variables

```
export STARCOIN_FAUCET_WORKER_MYSQL_HOST=localhost
export STARCOIN_FAUCET_WORKER_MYSQL_PORT=3306
export STARCOIN_FAUCET_WORKER_MYSQL_USER=
export STARCOIN_FAUCET_WORKER_MYSQL_PWD=
export STARCOIN_FAUCET_WORKER_MYSQL_DB=
export STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_BARNARD=[\"<PRIVATEKEY1>\",\"<PRIVATEKEY2>\"]
export STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_PROXIMA=[\"<PRIVATEKEY1>\",\"<PRIVATEKEY2>\"]
export STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_HALLEY=[\"<PRIVATEKEY1>\",\"<PRIVATEKEY2>\"]
export STARCOIN_FAUCET_WORKER_EMAIL_SENDER=
export STARCOIN_FAUCET_WORKER_EMAIL_SENDER_PWD=
export STARCOIN_FAUCET_WORKER_EMAIL_RECEIVERS=[\"<EMAIL1>\",\"<EMAIL2>\"]
```

Tips: [Generate Google account app passwords](https://stackoverflow.com/a/45479968/12454870)

# Install

```
npm install
```

# How to prevent current cron job submiting a transaction with same sequence number with the transaction submitted by the previous cron job while it is not finished yet.

The sender account's current sequence number is saved in `./data/<ADDRESS>.txt` locally.

It is used to prevent a cron job submit a trnasaction onto the chain with the same sequence number(locally and on the chain) and will be failed.

If the sequence number are equaly, the current job will abort immediately, and wait for the next cron job.

# How to use

1. Normally, we can batch transfer 5 new records each time with 1 sender.

```
node index.js --network=barnard --senderIndex=0 --count=5
```

The output is:

```
2022-05-19T08:34:45.865Z [info]: Connected to MySQL Server!
2022-05-19T08:34:45.865Z [info]: ---Job start---
2022-05-19T08:34:45.870Z [info]: 2 records founded.
2022-05-19T08:34:48.493Z [info]: transaction_hash: 0xd46c42e6d5d06909bb99cf4bf086682f1eece1ac20c6dacad6695c921fbda5f9
2022-05-19T08:34:48.493Z [info]: sequence_number: 287
2022-05-19T08:35:14.782Z [info]: status: Executed
2022-05-19T08:35:14.782Z [info]: gas_used: 221925
2022-05-19T08:35:14.782Z [info]: block_number: 4660095
2022-05-19T08:35:14.782Z [info]: ---Job finished---
```

2. In emergency conditions(eg. thousands of new records were added on the promotion day), we can batch handle them in parrael using multi senders.

```
node index.js --network=barnard --senderIndex=0 --count=50

node index.js --network=barnard --senderIndex=1 --count=50

...

```
