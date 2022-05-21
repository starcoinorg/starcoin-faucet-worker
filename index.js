const mysql = require('mysql2/promise');
const minimist = require('minimist');
const fs = require("fs");
const path = require('path');
const { utils, providers } = require('@starcoin/starcoin')
const { createLogger, format, transports } = require("winston");
const { combine, label, timestamp, printf } = format;
const nodemailer = require('nodemailer');

const STATUS = {
    'NEW': 0,
    'HANDLING': 1,
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

const checkBalance = async (provider, senderAddress, amountArray) => {
    const amountTotal = amountArray.reduce(
        (previous, current) => previous + current,
        0
    );
    const senderBalance = await provider.getBalance(senderAddress)
    // alert balance will be not enough
    if (senderBalance < 1000 * STC_SCALLING_FACTOR) {
        alertAdmin(`Sender ${ senderAddress } balance is less than 1000 STC`)
    }
    // Assuming maximum gas fee is 1 STC
    if ((amountTotal + (1 * STC_SCALLING_FACTOR)) < senderBalance) {
        return true
    }

    alertAdmin(`Sender ${ senderAddress } balance is less than ${ (amountTotal / STC_SCALLING_FACTOR).toFixed(0) } STC`)

    return false
}

const getFileName = (address) => {
    return `data/${ address }.txt`
}

const readSequenceNumber = async (address) => {
    const filePath = getFileName(address)

    try {
        const data = await fs.promises.readFile(filePath);
        return data.toString()
    } catch (error) {
        logger.error(`Got an error trying to read the file: ${ error.message }`);
        const fileDir = path.dirname(filePath)
        if (!fs.existsSync(fileDir)) {
            logger.error(`Directory ${ fileDir } not found.`);
            fs.promises.mkdir(fileDir, { recursive: true });
        }
        return "-1"
    }
}

const updateSequenceNumber = async (address, content) => {
    const filePath = getFileName(address)
    await fs.promises.writeFile(filePath, content)
}

const checkSequenceNumber = async (senderAddress, currentSenderSequenceNumber) => {
    const oldSequenceNumber = await readSequenceNumber(senderAddress)
    if (Number(oldSequenceNumber) < currentSenderSequenceNumber) {
        return true
    }
    return false
}

const batchTransfer = async (nodeUrl, provider, network, senderAddress, senderPrivateKey, senderSequenceNumber, addressArray, amountArray) => {
    const functionId = '0x1::TransferScripts::batch_peer_to_peer_v2'
    const typeArgs = ['0x1::STC::STC']
    const args = [addressArray, amountArray]

    const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(functionId, typeArgs, args, nodeUrl);

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

    return ['', txn.transaction_hash]
}

async function getNewRecords(pool, limit) {
    // Only handle the records: status = 0 and transfer_retry = 0
    try {
        const result = await pool.query(
            'SELECT id, network, address, amount from faucet_address where status = ? and transfer_retry = 0 LIMIT ?',
            [STATUS['NEW'], limit]
        );
        return result;
    } catch (err) {
        logger.error(err)
        return [[], null];
    }
}

async function updateRecordStatus(pool, ids) {
    try {
        console.log('updateRecordStatus', ids)
        await pool.query(
            'update faucet_address set status = ? where id in (?)',
            [STATUS['HANDLING'], ids]
        );
    } catch (err) {
        logger.error(err)
        return err;
    }
}

async function updateRecordTxn(pool, ids, txn) {
    try {
        console.log('updateRecordStatus', ids)
        await pool.query(
            'update faucet_address set status = ?, transfered_txn=? where id in (?)',
            [STATUS['SUCCEED'], txn, ids]
        );
    } catch (err) {
        logger.error(err)
        return err;
    }
}

async function main() {
    const pool = mysql.createPool({
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PWD,
        database: MYSQL_DB
    });
    try {
        logger.info('---Job start---')

        const args = minimist(process.argv.slice(2))
        const senderIndex = args['senderIndex'] || 0
        const limit = args['count'] || 5
        const [rows, _] = await getNewRecords(pool, limit)
        console.log({ rows })
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
            amounts.push(row.amount * STC_SCALLING_FACTOR)
        });

        const nodeUrl = `https://${ network }-seed.starcoin.org`
        const provider = new providers.JsonRpcProvider(nodeUrl);

        const sender = SENDERS[senderIndex]

        const { address: senderAddress, privateKey: senderPrivateKey } = sender

        // check sequenceNumber
        const senderSequenceNumber = await provider.getSequenceNumber(senderAddress)
        const isSequenceNumberOk = await checkSequenceNumber(senderAddress, senderSequenceNumber)
        if (!isSequenceNumberOk) {
            logger.error(`sender ${ senderAddress } sequenceNumber ${ senderSequenceNumber } is used.`)
            return;
        }
        await updateSequenceNumber(senderAddress, senderSequenceNumber.toString())


        // check balance
        const isBalanceOk = await checkBalance(provider, senderAddress, amounts)
        if (!isBalanceOk) {
            logger.error(`sender ${ senderAddress } balance is not enough`)
            return;
        }

        // update status=1
        const error = await updateRecordStatus(pool, ids)
        if (error) {
            logger.error(`Error occurs while updateRecordStatus = ${ STATUS['HANDLING'] }, ids in ${ ids }`)
            return
        }

        const [errorMessage, txn] = await batchTransfer(nodeUrl, provider, network, senderAddress, senderPrivateKey, senderSequenceNumber, addresses, amounts)
        console.log({ errorMessage, txn })
        if (errorMessage !== '') {
            logger.error(errorMessage)
            return
        }

        const error2 = await updateRecordTxn(pool, ids, txn)
        if (error2) {
            logger.error(`Error occurs while updateRecordTxn, txn = ${ txn }, ids in ${ ids }`)
            return
        }

    } catch (error) {
        logger.error(error)
    } finally {
        pool.end();
        logger.info('---Job finished---')
    }
}

main();