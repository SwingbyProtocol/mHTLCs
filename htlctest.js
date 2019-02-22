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
    let wallet1 = hdMaster.derivePath("m/44'/1'/0'/0/0") //btc testnet
    let wallet2 = hdMaster.derivePath("m/44'/1'/0'/0/1") //btc testnet

    //const child = hdMaster.derivePath("m/44'/0'/0'/0/0")   //btc mainnet
    //const child = hdMaster.derivePath("m/60'/0'/0'/0/0")   //ethereum main/test net

    wallet1.address = bitcoin.payments.p2pkh({
        pubkey: wallet1.publicKey,
        network: network
    }).address
    // mgxAoHvFDBs4qAU2Migf7wcY1AcJpzRPHY (btc testnet)
    // 12SDWEqGQARp43zQe9iHJ2QD9B1bwDPa77 (btc mainnet)
    wallet2.address = bitcoin.payments.p2pkh({
        pubkey: wallet2.publicKey,
        network: network
    }).address

    console.log(wallet1, wallet2.address, wallet1)


    //witness secret
    const ws = crypto.randomBytes(32)
    const wsh = bitcoin.crypto.sha256(ws)

    //lender secret
    const ls = crypto.randomBytes(32)
    const lsh = bitcoin.crypto.sha256(ls)

    //locktime 1400sec
    const lt = bip65.encode({
        utc: utcNow() + 1400
    })

    const htlc = await createScriptForLender(lt, lsh, wsh, wallet1.publicKey, wallet2.publicKey)

    console.log(htlc)

    const txId = await sendBTCTransaction(wallet1, htlc.htlcAddress, 1500000)
}

test()

function utcNow() {
    return Math.floor(Date.now() / 1000)
}

function sendBTCTransaction(from, to, satoshis) {
    return new Promise(async (resolve, reject) => {

        const utxoGroup = await getUTXO(from.address)

        console.log(network)

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
        console.log(data, txb.build())
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