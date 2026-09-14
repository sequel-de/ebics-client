#! /usr/bin/env node

'use strict';

// EBICS 3.0 (H005) equivalent of save-bank-keys.js.
//
// Your own keys must already be registered (examples/initialize-h005.js)
// and the subscriber activated on the bank's side. Fetches the bank's own
// X.509-certificate-wrapped public keys (HPB) and stores them alongside
// your own keys.
//
// Usage: node examples/save-bank-keys-h005.js <environment> <bank> [entity]

const { Orders } = require('../index');

const client = require('./getClient')();

client.send(Orders.H005.HPB)
	.then((resp) => {
		console.log('Response for HPB order %j', resp);
		if (resp.technicalCode !== '000000')
			throw new Error('Something went wrong');

		console.log('Received bank keys: %j', resp.bankKeys);
		return client.setBankKeys(resp.bankKeys);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
