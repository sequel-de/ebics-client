#! /usr/bin/env node

'use strict';

// EBICS 3.0 (H005) equivalent of send-sta-order.js / send-z53-order.js.
// Downloads camt.053 statements via a BTD order (Orders.H005.Z53); BTF
// parameters are overridable, see docs/EBICS-3.0-H005.md. Requires keys
// already registered (initialize-h005.js) and bank keys saved
// (save-bank-keys-h005.js).
//
// Usage: node examples/download-statement-h005.js <environment> <bank> [entity] [startDate] [endDate]

const { Orders, utils } = require('../index');

const client = require('./getClient')();

const [, , , , , startDate = null, endDate = null] = process.argv;

client.send(Orders.H005.Z53(startDate, endDate))
	.then((resp) => {
		console.log('Response for BTD (camt.053) order %j', {
			...resp,
			orderData: `<${resp.orderData.length} bytes>`,
		});
		if (resp.technicalCode !== '000000')
			throw new Error('Something went wrong');

		const files = utils.unzip(resp.orderData);
		files.forEach((file) => {
			console.log(`--- ${file.name} (${file.data.length} bytes) ---`);
			console.log(file.data.toString('utf8'));
		});
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
