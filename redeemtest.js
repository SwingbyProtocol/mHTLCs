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
    const treasury = hdMaster.derivePath("m/44'/1'/0'/0/1") //btc testnet
    treasury.address = bitcoin.payments.p2pkh({
        pubkey: treasury.publicKey,
        network: network
    }).address

    const ws = new Buffer(process.env.WS, 'hex')
    const ls = new Buffer(process.env.LS, 'hex')
    const rs = new Buffer(process.env.RS, 'hex')
    const lt = Number(process.env.LT)
    const txId = process.env.TX
    const vout = Number(process.env.VOUT)

    const txb = new bitcoin.TransactionBuilder(network)

    console.log(`ws = ${ws.toString('hex')} rs = ${rs.toString('hex')}`)
    console.log(`txId = ${txId} vout = ${vout}`)
    
    let fee = 10300

    //txb.setLockTime(lt)
    txb.addInput(txId, vout, 0xfffffffe)
    txb.addOutput(treasury.address, 1500000 - fee)

    const tx = txb.buildIncomplete()

    const sigHashType = bitcoin.Transaction.SIGHASH_ALL

    const signatureHash = tx.hashForSignature(0, rs, sigHashType)

    const redeemScriptSig = bitcoin.payments.p2sh({
        redeem: {
            input: bitcoin.script.compile([
                bitcoin.script.signature.encode(treasury.sign(signatureHash), sigHashType),
                treasury.publicKey,
                ws, // witness
                ls, // lender
                bitcoin.opcodes.OP_TRUE
            ]),
            output: rs
        }
    }).input
    tx.setInputScript(0, redeemScriptSig)
    console.log(`redeemTx = ${tx.toHex()}`)

}

test()