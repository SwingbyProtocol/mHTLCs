const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')
const bip65 = require('bip65')
const crypto = require('crypto')

const seedPhrase = process.env.SEED ? process.env.SEED : "door sad lonely priority omit burst virtual action cable humor verb orbit"

const fee = 30000

const network = bitcoin.networks.testnet

const seed = bip39.mnemonicToSeed(seedPhrase)

const hdMaster = bitcoin.bip32.fromSeed(seed, network) // seed from above
const child = hdMaster.derivePath("m/44'/1'/0'/0/0")   //btc testnet
//const child = hdMaster.derivePath("m/44'/0'/0'/0/0")   //btc mainnet
//const child = hdMaster.derivePath("m/60'/0'/0'/0/0")   //ethereum main/test net

const privateKey = child.privateKey.toString('hex')

const address = bitcoin.payments.p2pkh({
    pubkey: child.publicKey,
    network: network
}).address


function utcNow() {
    return Math.floor(Date.now() / 1000)
}

//witness secret
const ws = crypto.randomBytes(32)
const wsh = bitcoin.crypto.sha256(ws)

//lender secret
const ls = crypto.randomBytes(32)
const lsh = bitcoin.crypto.sha256(ls)

//locktime
const lt = bip65.encode({
    utc: utcNow() + 1400
})

// takes 1500ms

console.log(address, privateKey.toString('hex'))



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
            },
            network: network
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
