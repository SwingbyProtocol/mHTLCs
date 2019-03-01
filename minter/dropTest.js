const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')
const bip65 = require('bip65')
const crypto = require('crypto')
const got = require('got');

// test phrase
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

async function dropTest() {
    const seed = bip39.mnemonicToSeed(seedPhrase)

    const hdMaster = bitcoin.bip32.fromSeed(seed, network) // seed from above
    const treasury = hdMaster.derivePath("m/44'/1'/0'/0/2") //btc testnet
    
    treasury.address = bitcoin.payments.p2pkh({
        pubkey: treasury.publicKey,
        network: network
    }).address

    // get redeem script
    const rs = Buffer.from(process.env.RS, 'hex')
    const txId = String(process.env.TX)
    const vout = Number(process.env.VOUT)
    const lt = Number(process.env.LT)

    const txb = new bitcoin.TransactionBuilder(network)

    console.log(`rs = ${rs.toString('hex')}`)
    console.log(`txId = ${txId} vout = ${vout} lt = ${lt}`)

    let fee = 10300

    txb.setLockTime(lt)
    // Note: nSequence MUST be <= 0xfffffffe otherwise LockTime is ignored, and is immediately spendable.
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
                bitcoin.opcodes.OP_FALSE
            ]),
            output: rs
        }
    }).input
    tx.setInputScript(0, redeemScriptSig)
    console.log(`refundTx = ${tx.toHex()}`)

}

dropTest()