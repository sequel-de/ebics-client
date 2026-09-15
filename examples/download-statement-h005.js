#! /usr/bin/env node

'use strict';

// EBICS 3.0 (H005) equivalent of send-sta-order.js / send-z53-order.js.
//
// Downloads camt.053 end-of-period account statements via a BTD (business
// transaction download) order. Orders.H005.Z53 defaults to the Swiss
// market-practice BTF parameters (ServiceName=EOP, Scope=CH,
// MsgName=camt.053 v08, ZIP container) - see docs/EBICS-3.0-H005.md and
// lib/predefinedOrders/h005/Z53.js - but every one of those is overridable
// for a different bank/market/message type, e.g.
// Orders.H005.Z53(startDate, endDate, { scope: 'DE' }). The response is
// unzipped here since a ZIP container was requested; pass
// { container: false } and skip the unzip step if yours doesn't use one.
//
// Your own keys must already be registered (examples/initialize-h005.js)
// and the bank's keys saved (examples/save-bank-keys-h005.js).
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
