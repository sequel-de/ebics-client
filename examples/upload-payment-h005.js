#! /usr/bin/env node

'use strict';

// EBICS 3.0 (H005) payment upload via a BTU order (Orders.H005.CCT).
// Defaults to Swiss market practice (MCT/CH/pain.001 v09); BTF parameters
// are overridable, see docs/EBICS-3.0-H005.md. Requires keys already
// registered (initialize-h005.js) and bank keys saved (save-bank-keys-h005.js).
//
// NOT YET VALIDATED against a live bank - a payment upload submits a real
// instruction even in a bank's test system, so run this deliberately.
//
// Usage: node examples/upload-payment-h005.js <environment> <bank> <paymentFile> [entity]

const fs = require('fs');

const { Orders } = require('../index');
const loadConfig = require('./loadConfig');
const getClient = require('./getClient');

const [, , env, bank, paymentFile, entity] = process.argv;

if (!paymentFile) {
	console.error('Usage: node examples/upload-payment-h005.js <environment> <bank> <paymentFile> [entity]');
	process.exit(1);
}

const document = fs.readFileSync(paymentFile, 'utf8');
const client = getClient(loadConfig(undefined, env, bank, entity || ''));

client.send(Orders.H005.CCT(document))
	.then(([transactionId, orderId]) => {
		console.log('BTU (pain.001) upload accepted: transactionId=%s orderId=%s', transactionId, orderId);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
