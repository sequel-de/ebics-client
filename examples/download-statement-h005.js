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
const loadConfig = require('./loadConfig');
const getClient = require('./getClient');

// getClient()/loadConfig() read process.argv[4] as `entity` unconditionally,
// which would silently shift startDate/endDate by one slot whenever entity
// is omitted (an entirely valid usage per the [entity] above). Detect that
// case by checking whether the argument in the entity slot actually looks
// like a date, and shift our own parsing accordingly.
const isDateArg = arg => /^\d{4}-\d{2}-\d{2}$/.test(arg || '');
const [, , env, bank, arg4, arg5, arg6] = process.argv;
const hasEntity = Boolean(arg4) && !isDateArg(arg4);
const entity = hasEntity ? arg4 : '';
const [startDate = null, endDate = null] = hasEntity ? [arg5, arg6] : [arg4, arg5];

const client = getClient(loadConfig(undefined, env, bank, entity));

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
