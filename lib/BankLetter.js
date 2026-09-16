'use strict';

const fs = require('fs');

const handlebars = require('handlebars');
const Crypto = require('./crypto/Crypto');
const { date } = require('./utils.js');

const registerHelpers = () => {
	handlebars.registerHelper('today', () => date.toISODate(Date.now(), false));

	handlebars.registerHelper('now', () => date.toISOTime(Date.now(), false));

	handlebars.registerHelper('keyExponentBits', k => Buffer.byteLength(k.e()) * 8);

	handlebars.registerHelper('keyModulusBits', k => k.size());

	handlebars.registerHelper('keyExponent', k => k.e('hex'));

	handlebars.registerHelper('keyModulus', k => k.n('hex').toUpperCase().match(/.{1,2}/g).join(' '));

	handlebars.registerHelper('sha256', (k) => {
		const digest = Buffer.from(Crypto.digestPublicKey(k), 'base64').toString('HEX');
		return digest.toUpperCase().match(/.{1,2}/g).join(' ');
	});

	// EBICS 3.0 (H005) helpers: H005 keys are wrapped in a self-signed X.509
	// certificate, and the digest a bank actually compares against
	// <BankPubKeyDigests> is the SHA-256 hash of the certificate's raw DER
	// bytes (Crypto.digestCertificate) - not keyModulus/keyExponent/sha256
	// above, which hash the bare RSA key and only apply to H004.
	const requireCert = (k) => {
		if (!k.hasCertificate())
			throw new Error('This key has no certificate - use the H004 templates/helpers (keyModulus/keyExponent/sha256) for a key without one.');
	};

	handlebars.registerHelper('certDigest', (k) => {
		requireCert(k);
		const digest = Buffer.from(Crypto.digestCertificate(k), 'base64').toString('HEX');
		return digest.toUpperCase().match(/.{1,2}/g).join(' ');
	});

	handlebars.registerHelper('certSerial', (k) => {
		requireCert(k);
		return k.certificateSerialNumber().match(/.{1,2}/g).join(' ');
	});

	handlebars.registerHelper('certSubject', (k) => {
		requireCert(k);
		return k.certificateSubject();
	});

	handlebars.registerHelper('certValidUntil', (k) => {
		requireCert(k);
		const { notAfter } = k.certificateValidity();
		// EBICS 3.0's "unlimited validity" convention (see Key.js's
		// UNLIMITED_VALIDITY) - 9999-12-31 means "does not expire", which
		// reads better on a letter than the literal date.
		if (notAfter.getUTCFullYear() >= 9999) return 'unlimited';
		return date.toISODate(notAfter, false);
	});
};

const writeFile = (file, content) => new Promise((resolve, reject) => fs.writeFile(file, content, (err, result) => {
	if (err)
		return reject(err);
	return resolve(result);
}));
module.exports = class BankLetter {
	constructor({
		client,
		bankName,
		template,
	}) {
		this.client = client;
		this.bankName = bankName;
		this.template = template;
	}

	async generate() {
		registerHelpers();

		const templ = handlebars.compile(this.template);
		const keys = await this.client.keys();

		const data = {
			bankName: this.bankName,
			userId: this.client.userId,
			partnerId: this.client.partnerId,
			A006: keys.a(),
			X002: keys.x(),
			E002: keys.e(),
		};

		return templ(data);
	}

	async serialize(path) {
		const letter = await this.generate();
		await writeFile(path, letter);
		return true;
	}
};
