const mysql = require('mysql');
const minimist = require('minimist');
const { utils, providers } = require('@starcoin/starcoin')
const { createLogger, format, transports } = require("winston");
const { combine, label, timestamp, printf } = format;
const nodemailer = require('nodemailer');

const STATUS = {
    'NEW': 0,
    'SUCCEED': 20,
}
const emailSender = process.env.STARCOIN_FAUCET_WORKER_EMAIL_SENDER || ''
const emailSenderPwd = process.env.STARCOIN_FAUCET_WORKER_EMAIL_SENDER_PWD || ''
const emailReceivers = JSON.parse(process.env.STARCOIN_FAUCET_WORKER_EMAIL_RECEIVERS || []).join(",")

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: emailSender,
        pass: emailSenderPwd
    }
});



const alertAdmin = (message) => {
    //  send email
    const mailOptions = {
        from: 'Faucet Worker',
        to: emailReceivers,
        subject: message,
        text: message
    };
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            logger.error(error);
        } else {
            logger.info('Email sent: ' + info.response);
        }
    });
    //  TODO: call discord/twitter api
}

const loggerFormat = printf(info => `${ info.timestamp } [${ info.level }]: ${ typeof info.message === 'object' ? JSON.stringify(info.message) : info.message }`);

const logLevels = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
};

const logger = createLogger({
    level: "warn",
    levels: logLevels,
    format: combine(
        timestamp(),
        loggerFormat
    ),
    transports: [new transports.Console({ level: "info" })],
});

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
    logger.info('---Job start---')
    const args = minimist(process.argv.slice(2))

    const senderIndex = args['senderIndex'] || 0
    const limit = args['count'] || 5
    // Only handle the records: status = 0 and transfer_retry = 0
    connection.query(
        'SELECT id, network, address, amount from faucet_address where status = ? and transfer_retry = 0 LIMIT ?',
        [STATUS['NEW'], limit],
        (err, rows) => {
            console.log(rows)
            if (err) throw err;
            if (rows.length === 0) {
                logger.info('No rows to handle!')
                return;
            }
            logger.info(`${ rows.length } records found.`)
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
            // update records during transfer, in case other job re-handle them
            connection.query(
                'update faucet_address set transfer_retry = 1 where id in (?)',
                [ids],
                (err, rows) => {
                    if (err) throw err;
                    const sender = SENDERS[senderIndex]
                    batchTransfer(network, sender, addresses, amounts).then((errorMessage) => {
                        if (errorMessage !== '') {
                            logger.error(errorMessage)
                        }
                        const status = STATUS['SUCCEED']
                        // update status
                        connection.query(
                            'update faucet_address set status = ? where id in (?)',
                            [status, ids],
                            (err, rows) => {
                                if (err) throw err;
                                connection.end();
                                logger.info('---Job finished---')
                            }
                        )
                    })
                }
            )
        }
    );
}

const checkBalance = async (provider, senderAddress, amountArray) => {
    const amountTotal = amountArray.reduce(
        (previous, current) => previous + current,
        0
    );
    const senderBalance = await provider.getBalance(senderAddress)
    // alert balance will be not enough
    if (senderBalance < 1000 * STC_SCALLING_FACTOR) {
        alertAdmin('Sender balance is less than 1000 STC')
    }
    // Assuming maximum gas fee is 1 STC
    if ((amountTotal + (1 * STC_SCALLING_FACTOR)) < senderBalance) {
        return true
    }
    return false
}

const batchTransfer = async (network, sender, addressArray, amountArray) => {
    const { address: senderAddress, privateKey: senderPrivateKey } = sender
    const nodeUrl = `https://${ network }-seed.starcoin.org`
    const provider = new providers.JsonRpcProvider(nodeUrl);

    // check balance
    const isOk = await checkBalance(provider, senderAddress, amountArray)
    if (!isOk) {
        return 'sender balance is not enough'
    }
    const functionId = '0x1::TransferScripts::batch_peer_to_peer_v2'
    const typeArgs = ['0x1::STC::STC']
    const args = [addressArray, amountArray]

    const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(functionId, typeArgs, args, nodeUrl);

    const senderSequenceNumber = await provider.getSequenceNumber(senderAddress)
    const chainId = NETWORK_MAP[network];
    const nowSeconds = await provider.getNowSeconds();

    const rawUserTransaction = utils.tx.generateRawUserTransaction(
        senderAddress,
        scriptFunction,
        10000000,
        1,
        senderSequenceNumber,
        nowSeconds + 43200,
        chainId,
    );

    const signedUserTransactionHex = await utils.tx.signRawUserTransaction(
        senderPrivateKey,
        rawUserTransaction,
    );

    const txn = await provider.sendTransaction(signedUserTransactionHex);

    logger.info(`transaction_hash: ${ txn.transaction_hash }`)
    logger.info(`sequence_number: ${ txn.raw_txn.sequence_number }`)

    const txnInfo = await txn.wait(1);

    logger.info(`status: ${ txnInfo.status }`)
    logger.info(`gas_used: ${ txnInfo.gas_used }`)
    logger.info(`block_number: ${ txnInfo.block_number }`)
    return ''
}

const connection = mysql.createConnection({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PWD,
    database: MYSQL_DB
});

connection.connect((err) => {
    if (err) throw err;
    logger.info('Connected to MySQL Server!');
    doJob();
});

