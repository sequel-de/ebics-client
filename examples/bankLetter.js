#! /usr/bin/env node

'use strict';

const ebics = require('../index');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('./loadConfig')();
const client = require('./getClient')(config);
const bankName = client.bankName;

(async () => {
	// EBICS 3.0 (H005) keys carry a self-signed X.509 certificate (see
	// lib/keymanagers/Key.js); H004 keys don't. Pick the matching template
	// set automatically rather than requiring the caller to say which EBICS
	// version they're on - the templates/helpers differ (certificate
	// subject/serial/validity/fingerprint for H005 vs raw modulus/exponent
	// for H004), see lib/BankLetter.js.
	const keys = await client.keys();
	if (!keys) throw new Error('No keys found - run INI/HIA first (see initialize-h005.js or the H004 equivalent).');

	const isH005 = keys.a().hasCertificate();
	const templateName = isH005 ? `ini_h005_${client.languageCode}` : `ini_${client.languageCode}`;
	const template = fs.readFileSync(path.join(__dirname, `../templates/${templateName}.hbs`), { encoding: 'utf8' });
	const bankLetterFile = path.join("./", "bankLetter_"+client.bankShortName+"_"+client.languageCode+".html");

	const letter = new ebics.BankLetter({ client, bankName, template });

	await letter.serialize(bankLetterFile);
	console.log('Send your bank the letter (%s)', bankLetterFile);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
