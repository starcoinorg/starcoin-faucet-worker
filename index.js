const mysql = require('mysql2/promise');
const minimist = require('minimist');
const fs = require("fs");
const path = require('path');
const { utils, providers, encoding } = require('@starcoin/starcoin')
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

const alertAdmin = (title, message) => {
    //  send email
    const mailOptions = {
        from: 'Starcoin-Faucet-Worker',
        to: emailReceivers,
        subject: title,
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
const STC_SCALLING_FACTOR = 1000000000

const NETWORK_MAP = {
    "barnard": {
        "url": "https://barnard-seed.starcoin.org",
        "chainId": 251,
        "senderPrivateKeys": JSON.parse(process.env.STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_BARNARD || [])
    },
    "proxima": {
        "url": "https://proxima-seed.starcoin.org",
        "chainId": 252,
        "senderPrivateKeys": JSON.parse(process.env.STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_PROXIMA || [])
    },
    "halley": {
        "url": "https://halley-seed.starcoin.org",
        "chainId": 253,
        "senderPrivateKeys": JSON.parse(process.env.STARCOIN_FAUCET_WORKER_SENDER_PRIVATE_KEYS_HALLEY || [])
    }
}

const checkBalance = async (provider, senderAddress, amountArray, network) => {
    const amountTotal = amountArray.reduce(
        (previous, current) => previous + current,
        0
    );
    const senderBalance = await provider.getBalance(senderAddress)
    // alert balance will be not enough
    if (senderBalance < 1000 * STC_SCALLING_FACTOR) {
        alertAdmin(`Warning: Starcoin Faucet in ${ network }`, `Sender ${ senderAddress } balance is less than 1000 STC`)
    }
    // Assuming maximum gas fee is 1 STC
    if ((amountTotal + (1 * STC_SCALLING_FACTOR)) < senderBalance) {
        return true
    }
    alertAdmin(`Error: Starcoin Faucet in ${ network }`, `Sender ${ senderAddress } balance is less than ${ (amountTotal / STC_SCALLING_FACTOR).toFixed(0) } STC`)

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

const batchTransfer = async (nodeUrl, provider, chainId, senderAddress, senderPrivateKey, senderSequenceNumber, addressArray, amountArray) => {
    try {
        const functionId = '0x1::TransferScripts::batch_peer_to_peer_v2'
        const typeArgs = ['0x1::STC::STC']
        const args = [addressArray, amountArray]

        const scriptFunction = await utils.tx.encodeScriptFunctionByResolve(functionId, typeArgs, args, nodeUrl);

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
    } catch (error) {
        logger.error(error)
        return [error, null]
    }
}

const getNewRecords = async (pool, network, limit) => {
    // Only handle the records: status = 0 and transfer_retry = 0
    try {
        const result = await pool.query(
            'SELECT id, address, amount from faucet_address where network = ? and status = ? and transfer_retry = 0 LIMIT ?',
            [network, STATUS['NEW'], limit]
        );
        return result;
    } catch (err) {
        logger.error(err)
        return [[], null];
    }
}

const updateRecordHandling = async (pool, ids) => {
    try {
        await pool.query(
            'update faucet_address set status = ? where id in (?)',
            [STATUS['HANDLING'], ids]
        );
    } catch (err) {
        logger.error(err)
        return err;
    }
}

const updateRecordTxn = async (pool, ids, txn) => {
    try {
        await pool.query(
            'update faucet_address set status = ?, transfered_txn=?, transfered_at = now() where id in (?)',
            [STATUS['SUCCEED'], txn, ids]
        );
    } catch (err) {
        logger.error(err)
        return err;
    }
}

const main = async () => {
    const pool = mysql.createPool({
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PWD,
        database: MYSQL_DB
    });
    let oldSequenceNumber, currentSenderSequenceNumber, senderAddress, senderPrivateKey
    try {
        logger.info('---Job start---')
        const args = minimist(process.argv.slice(2))
        const network = args['network'] || 'barnard'
        const senderIndex = args['senderIndex'] || 0
        const limit = args['count'] || 5
        const senderPrivateKeys = NETWORK_MAP[network]?.senderPrivateKeys

        const [rows, _] = await getNewRecords(pool, network, limit)
        if (rows.length === 0) {
            logger.info('No rows to handle!')
            return;
        }
        logger.info(`${ rows.length } records found.`)
        const ids = []
        const addresses = []
        const amounts = []
        rows.forEach(row => {
            ids.push(row.id)
            addresses.push(row.address)
            amounts.push(row.amount * STC_SCALLING_FACTOR)
        });
        logger.info(addresses)
        const nodeUrl = NETWORK_MAP[network]?.url
        const provider = new providers.JsonRpcProvider(nodeUrl);

        senderPrivateKey = senderPrivateKeys[senderIndex]
        const senderPublicKey = await encoding.privateKeyToPublicKey(senderPrivateKey)
        senderAddress = encoding.publicKeyToAddress(senderPublicKey)
        // check sequenceNumber
        oldSequenceNumber = await readSequenceNumber(senderAddress)
        currentSenderSequenceNumber = await provider.getSequenceNumber(senderAddress)
        if (!(Number(oldSequenceNumber) < currentSenderSequenceNumber)) {
            logger.error(`sender ${ senderAddress } sequenceNumber ${ currentSenderSequenceNumber } is outdated.`)
            return;
        }
        await updateSequenceNumber(senderAddress, currentSenderSequenceNumber.toString())


        // check balance
        const isBalanceOk = await checkBalance(provider, senderAddress, amounts, network)
        if (!isBalanceOk) {
            throw (`sender ${ senderAddress } balance is not enough`)
        }

        // update status=1
        const error = await updateRecordHandling(pool, ids)
        if (error) {
            throw (`Error occurs while updateRecordHandling, ids in ${ ids }`)
        }

        const chainId = NETWORK_MAP[network]?.chainId
        const [errorMessage, txn] = await batchTransfer(nodeUrl, provider, chainId, senderAddress, senderPrivateKey, currentSenderSequenceNumber, addresses, amounts)
        if (errorMessage !== '') {
            throw (errorMessage)
        }

        {
            const error = await updateRecordTxn(pool, ids, txn)
            if (error) {
                throw (`Error occurs while updateRecordTxn, txn = ${ txn }, ids in ${ ids }`)
            }
        }


    } catch (error) {
        logger.error(error)
        // should reset oldSequenceNumber in ./data/<ADDRESS>.txt if any problem occurs after is is updated to currentSequenceNumber
        if (oldSequenceNumber && currentSenderSequenceNumber && (Number(oldSequenceNumber) !== currentSenderSequenceNumber)) {
            await updateSequenceNumber(senderAddress, oldSequenceNumber)
        }
    } finally {
        pool.end();
        logger.info('---Job finished---')
    }
}

main();