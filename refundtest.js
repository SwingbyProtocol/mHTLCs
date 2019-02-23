const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')
const bip65 = require('bip65')
const crypto = require('crypto')
const got = require('got');

const seedPhrase = process.env.SEED ? process.env.SEED : "door sad lonely priority omit burst virtual action cable humor verb orbit"

const fee = 30000

const network = bitcoin.networks.testnet

let test3 = (network == bitcoin.networks.testnet) ? 'test-' : ''
const client = got.extend({
    baseUrl: `https://${test3}insight.bitpay.com/api`,
    headers: {
        "Content-Type": "application/json"
    }
});

async function test() {
    const seed = bip39.mnemonicToSeed(seedPhrase)

    const hdMaster = bitcoin.bip32.fromSeed(seed, network) // seed from above
    const lender = hdMaster.derivePath("m/44'/1'/0'/0/0") //btc testnet
    lender.address = bitcoin.payments.p2pkh({
        pubkey: lender.publicKey,
        network: network
    }).address

    const ls = new Buffer(process.env.LS, 'hex')
    const rs = new Buffer(process.env.RS, 'hex')
    const tx = process.env.TX
    const vout = process.env.VOUT

    const txb = new bitcoin.TransactionBuilder(network)

    console.log(ls, rs, tx, vout)

    //txb.setLockTime(oldlocktme)
    txb.addInput(tx, vout, 0xfffffffe)
    txb.addOutput(lender.address, 1500000 - fee)

    const sigHashType = bitcoin.Transaction.SIGHASH_ALL

    const redeemScriptSig = bitcoin.payments.p2sh({
        redeem: {
            input: bitcoin.script.compile([
                bitcoin.script.signature.encode(lender.sign(signatureHash), sigHashType),
                lender.publicKey,
                ls,
                bitcoin.opcodes.OP_FALSE
            ]),
            output: rs
        }
    }).input
    tx.setInputScript(0, redeemScriptSig)
    console.log(`refund = ${tx.toHex()}`)

}

test()

function utcNow() {
    return Math.floor(Date.now() / 1000)
}

function sendBTCTransaction(from, to, satoshis) {
    return new Promise(async (resolve, reject) => {

        const utxoGroup = await getUTXO(from.address)

        const txb = new bitcoin.TransactionBuilder(network)
        // txb.setVersion(1)
        let fee = 10300
        let total = 0
        let count = 0

        utxoGroup.forEach((utxo, i) => {
            if (total < satoshis) {
                txb.addInput(utxo.txid, utxo.vout)
                total += utxo.satoshis
                count++
            }
        })

        txb.addOutput(to, satoshis) // the actual "spend"
        txb.addOutput(from.address, total - satoshis - fee)


        if (total < satoshis) {
            reject('balance insufficient')
        }
        for (var i = 0; i < count; i++) {
            txb.sign(i, from)

        }
        // (in)15000 - (out)12000 = (fee)3000, this is the miner fee
        // txb.sign(1, key)

        const data = {
            'tx': txb.build().toHex()
        }
        console.log(data)
    })
}

async function getUTXO(addr) {
    return new Promise(async (resolve, reject) => {
        const res = await client.get(`/addr/${addr}/utxo`);

        let utxo = JSON.parse(res.body)
        utxo.sort((x, y) => {
            return y.satoshis - x.satoshis
        })
        //console.log(utxo)
        resolve(utxo)
    })
}




function createScriptForLender(locktime, lsh, wsh, treasury, lender) {
    return new Promise((resolve, reject) => {
        if (locktime <= utcNow()) {
            reject('error')
        }

        const treasuryHash = bitcoin.crypto.hash160(treasury)

        const lenderHash = bitcoin.crypto.hash160(lender)
        // var now = Math.floor(Date.now() / 1000) 

        var redeemScript = bitcoin.script.compile([
            bitcoin.opcodes.OP_IF,
            // Stack: <treasury Sig> <pubkey> <witness secret> <lender secret>
            bitcoin.opcodes.OP_SHA256,
            // witness secret hash
            wsh,
            bitcoin.opcodes.OP_EQUALVERIFY,
            // Stack: <treasury Sig> <pubkey> <witness secret> 
            bitcoin.opcodes.OP_SHA256,
            // lender secret hash
            lsh,
            bitcoin.opcodes.OP_EQUALVERIFY,
            // Stack: <treasury Sig> <pubkey> 
            bitcoin.opcodes.OP_DUP,
            // Stack: <treasury Sig> <pubkey> <pubkey>
            bitcoin.opcodes.OP_HASH160,
            // Stack: <treasury Sig> <pubkey> <treasuryHash>
            treasuryHash,

            bitcoin.opcodes.OP_ELSE,
            bitcoin.script.number.encode(locktime),
            // Stack: <lender Sig> <pubkey> <lender secret> <locktime>
            bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
            bitcoin.opcodes.OP_DROP,
            // Stack: <lender Sig> <pubkey> <lender secret>
            bitcoin.opcodes.OP_SHA256,
            // lender seccret hash
            lsh,
            bitcoin.opcodes.OP_EQUALVERIFY,
            // Stack: <lender Sig> <pubkey>
            bitcoin.opcodes.OP_DUP,
            // Stack: <lender Sig> <pubkey> <pubkey>
            bitcoin.opcodes.OP_HASH160,
            // Stack: <lender Sig> <pubkey> <lenderhash>
            lenderHash,
            bitcoin.opcodes.OP_ENDIF,

            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ])

        const htlcAddress = bitcoin.payments.p2sh({
            redeem: {
                output: redeemScript,
                network: network
            }
        })
        var data = {
            htlcAddress: htlcAddress.address,
            lsh: lsh.toString('hex'),
            wsh: wsh.toString('hex'),
            redeemScript: redeemScript.toString('hex'),
            txId: ''
        }
        resolve(data)
    })
}