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
npm install
```

# How to use

1. Normally, we can batch transfer 5 new records each time with 1 sender.

```
node index.js --senderIndex=0 --count=5
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
node index.js --senderIndex=0 --count=50

node index.js --senderIndex=1 --count=50

...

```
