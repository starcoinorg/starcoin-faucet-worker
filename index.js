const mysql = require('mysql');
const minimist = require('minimist');
const { encoding, utils, providers } = require('@starcoin/starcoin')

const MYSQL_HOST = process.env.STARCOIN_FAUCET_WORKER_MYSQL_HOST || ''
const MYSQL_USER = process.env.STARCOIN_FAUCET_WORKER_MYSQL_USER || ''
const MYSQL_PWD = process.env.STARCOIN_FAUCET_WORKER_MYSQL_PWD || ''
const MYSQL_DB = process.env.STARCOIN_FAUCET_WORKER_MYSQL_DB || ''
const SENDERS = JSON.parse(process.env.STARCOIN_FAUCET_WORKER_SENDERS || [])
const STC_SCALLING_FACTOR = 1000000000
const NETWORK_MAP = {
    'main': 1,
    'barnard': 251
}

const doJob = () => {
    console.log('Job start')
    const args = minimist(process.argv.slice(2))

    const senderIndex = args['senderIndex'] || 0
    const limit = args['count'] || 5
    connection.query(`SELECT id, network, address, amount from faucet_address where status=0 and transfer_retry=0 LIMIT ${ limit }`, (err, rows) => {
        if (err) throw err;
        if (rows.length === 0) {
            console.log('No rows to handle!')
            return;
        }
        console.log(`${ rows.length } records founded.`)
        const ids = []
        const addresses = []
        const amounts = []
        let network = ''
        rows.forEach(row => {
            network = row.network
            ids.push(row.id)
            addresses.push(row.address)
            // amounts.push(row.amount * STC_SCALLING_FACTOR)
            amounts.push(0.01 * STC_SCALLING_FACTOR)
        });
        // console.log({ ids, addresses, amounts })

        const sender = SENDERS[senderIndex]
        batchTransfer(network, sender, addresses, amounts)
        console.log('Job finished')
    });
    connection.end();
}

const batchTransfer = async (network, sender, addressArray, amountArray) => {
    const { address, privateKey } = sender
    const functionId = '0x1::TransferScripts::batch_peer_to_peer_v2'
    const typeArgs = ['0x1::STC::STC']
    const args = [addressArray, amountArray]

    const nodeUrl = `https://${ network }-seed.starcoin.org`
    const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(functionId, typeArgs, args, nodeUrl);

    const provider = new providers.JsonRpcProvider(nodeUrl);
    const senderSequenceNumber = await provider.getSequenceNumber(address)
    const chainId = NETWORK_MAP[network];
    const nowSeconds = await provider.getNowSeconds();
    // console.log({ senderSequenceNumber, nowSeconds })
    const rawUserTransaction = utils.tx.generateRawUserTransaction(
        address,
        scriptFunction,
        10000000,
        1,
        senderSequenceNumber,
        nowSeconds + 43200,
        chainId,
    );

    const rawUserTransactionHex = encoding.bcsEncode(rawUserTransaction)
    // console.log({ rawUserTransactionHex })

    const signedUserTransactionHex = await utils.tx.signRawUserTransaction(
        privateKey,
        rawUserTransaction,
    );

    const txn = await provider.sendTransaction(signedUserTransactionHex);
    // console.log({ txn });
    console.log('transaction_hash:', txn.transaction_hash)
    console.log('sequence_number', txn.raw_txn.sequence_number)
    const txnInfo = await txn.wait(1);
    // console.log({ txnInfo });
    console.log('status:', txnInfo.status);
    console.log('gas_used:', txnInfo.gas_used);
    console.log('block_number:', txnInfo.block_number);

}

const connection = mysql.createConnection({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PWD,
    database: MYSQL_DB
});

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Server!');
    doJob();
});

