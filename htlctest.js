const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')
const bip65 = require('bip65')
const crypto = require('crypto')
const got = require('got');

const seedPhrase = process.env.SEED ? process.env.SEED : "door sad lonely priority omit burst virtual action cable humor verb orbit"

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
    let lender = hdMaster.derivePath("m/44'/1'/0'/0/0") //btc testnet
    let treasury = hdMaster.derivePath("m/44'/1'/0'/0/1") //btc testnet

    //const child = hdMaster.derivePath("m/44'/0'/0'/0/0")   //btc mainnet
    //const child = hdMaster.derivePath("m/60'/0'/0'/0/0")   //ethereum main/test net

    lender.address = bitcoin.payments.p2pkh({
        pubkey: lender.publicKey,
        network: network
    }).address
    // mgxAoHvFDBs4qAU2Migf7wcY1AcJpzRPHY (btc testnet)
    // 12SDWEqGQARp43zQe9iHJ2QD9B1bwDPa77 (btc mainnet)
    treasury.address = bitcoin.payments.p2pkh({
        pubkey: treasury.publicKey,
        network: network
    }).address

    console.log(lender.address, treasury.address)

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

    const htlc = await createScriptForLender(lt, lsh, wsh, treasury.publicKey, lender.publicKey)

    console.log(`ws = ${ws.toString('hex')} ls = ${ls.toString('hex')} lt = ${lt}`)
    console.log(`htlc = ${htlc.address}`)
    console.log(`rs = ${htlc.rs}`)

    const tx = await sendBTCTransaction(lender, htlc.address, 1500000)

    console.log(tx)
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
        resolve(data)
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
            lsh,
            bitcoin.opcodes.OP_EQUALVERIFY,
            // Stack: <treasury Sig> <pubkey> <witness secret> 
            bitcoin.opcodes.OP_SHA256,
            // lender secret hash
            wsh,
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
            address: htlcAddress.address,
            lsh: lsh.toString('hex'),
            wsh: wsh.toString('hex'),
            rs: redeemScript.toString('hex'),
            txId: ''
        }
        resolve(data)
    })
}