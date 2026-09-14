#! /usr/bin/env node

'use strict';

// EBICS 3.0 (H005) equivalent of initialize.js.
//
// Generates an A006/X002/E002 key pair - each key wrapped in a self-signed
// X.509 certificate, which is how H005 carries public keys (H004 sends a
// raw RSA modulus/exponent instead) - and sends INI + HIA to register the
// certificates with your bank. New keys are generated and saved via the
// same keyStorage/passphrase config used by the H004 examples (see
// examples/config), the first time this runs.
//
// Usage: node examples/initialize-h005.js <environment> <bank> [entity]

const { Orders } = require('../index');

const client = require('./getClient')();

client.send(Orders.H005.INI)
	.then((resp) => {
		console.log('Response for INI order %j', resp);
		if (resp.technicalCode !== '000000')
			throw new Error('Something might have gone wrong');

		return client.send(Orders.H005.HIA);
	})
	.then((resp) => {
		console.log('Response for HIA order %j', resp);
		if (resp.technicalCode !== '000000')
			throw new Error('Something might have gone wrong');

		console.log('Your public key certificates have been sent to the bank.');
		console.log('Depending on your bank, the subscriber may need to be activated before HPB works - some banks require a signed Initialization Letter (see examples/bankLetter.js - note it currently prints the H004-style raw-key fingerprint, not H005\'s certificate digest, so double check with your bank which format they expect), others activate via an online banking portal or automatically in a test environment.');
		console.log('Once activated, run: node examples/save-bank-keys-h005.js <environment> <bank> [entity]');
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
