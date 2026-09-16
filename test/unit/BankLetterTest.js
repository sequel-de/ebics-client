'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');
const { join, resolve } = require('path');
const {
	readFileSync, mkdirSync, existsSync, unlinkSync,
} = require('fs');
const os = require('os');

const BankLetter = require('../../lib/BankLetter');
const Crypto = require('../../lib/crypto/Crypto');
const Key = require('../../lib/keymanagers/Key');
const ebics = require('../../');

const client = new ebics.Client({
	url: 'https://iso20022test.credit-suisse.com/ebicsweb/ebicsweb',
	partnerId: 'CRS04381',
	userId: 'CRS04381',
	hostId: 'CRSISOTB',
	passphrase: 'test',
	keyStorage: ebics.fsKeysStorage(resolve(__dirname, '../support/TEST_KEYS.key')),
});

const createDir = (where) => {
	try {
		mkdirSync(where);
	} catch (e) {
		if (e.code !== 'EEXIST')
			throw e;
	}
};

describe('BankLetter', () => {
	let bankLetterGenerator = null;

	it('creates an instance', () => assert.doesNotThrow(() => {
		bankLetterGenerator = new BankLetter({
			client,
			bankName: 'Credit Suisse AG',
			template: readFileSync(join(__dirname, '../../templates/ini_de.hbs'), { encoding: 'utf8' }),
		});
	}));

	it('genrates a letter', async () => assert.doesNotThrow(async () => bankLetterGenerator.generate()));
	it('throws with invalid serliazitaion path', async () => bankLetterGenerator.serialize('').catch(e => assert.instanceOf(e, Error)));
	it('serliaziers a letter to disk', async () => {
		createDir('.test_tmp');
		await bankLetterGenerator.serialize('.test_tmp/test_letter.html').then(t => assert.equal(t, true));
		assert.equal(existsSync('.test_tmp/test_letter.html'), true);
	});
});

// EBICS 3.0 (H005) keys carry a self-signed X.509 certificate - the bank
// letter needs the certificate-based templates/helpers (certDigest etc.,
// see lib/BankLetter.js), not the H004 ones above (keyModulus/keyExponent/
// sha256), which hash the bare RSA key and would be meaningless here: a
// bank checking an H005 subscriber's <BankPubKeyDigests> compares against
// the certificate's DER digest, not a modulus/exponent hash.
describe('BankLetter (EBICS 3.0 / H005 certificate-based keys)', () => {
	const keyPath = join(os.tmpdir(), `h005-bankletter-test-keys-${process.pid}-${Date.now()}.key`);
	let h005Client;
	let h005Keys;

	before(async () => {
		h005Client = new ebics.Client({
			url: 'https://example-bank.test/ebicsweb',
			partnerId: 'PARTNER1',
			userId: 'USER1',
			hostId: 'HOST1',
			passphrase: 'test',
			keyStorage: ebics.fsKeysStorage(keyPath),
		});

		await h005Client._generateKeys('h005'); // eslint-disable-line no-underscore-dangle
		h005Keys = await h005Client.keys();
	});

	after(() => {
		if (existsSync(keyPath)) unlinkSync(keyPath);
	});

	['de', 'en', 'fr'].forEach((lang) => {
		it(`renders the ${lang} H005 letter with each key's certificate subject/serial/validity/fingerprint`, async () => {
			const generator = new BankLetter({
				client: h005Client,
				bankName: 'Test Bank AG',
				template: readFileSync(join(__dirname, `../../templates/ini_h005_${lang}.hbs`), { encoding: 'utf8' }),
			});

			const letter = await generator.generate();
			const keysByLetterField = { A006: h005Keys.a(), X002: h005Keys.x(), E002: h005Keys.e() };

			Object.values(keysByLetterField).forEach((key) => {
				const digestHex = Buffer.from(Crypto.digestCertificate(key), 'base64').toString('hex').toUpperCase();
				const expectedDigest = digestHex.match(/.{1,2}/g).join(' ');
				const expectedSerial = key.certificateSerialNumber().match(/.{1,2}/g).join(' ');

				assert.include(letter, expectedDigest);
				assert.include(letter, expectedSerial);
				assert.include(letter, key.certificateSubject());
			});
		});
	});

	it('certDigest matches Crypto.digestCertificate - the same digest a bank compares BankPubKeyDigests against', async () => {
		const generator = new BankLetter({
			client: h005Client,
			bankName: 'Test Bank AG',
			template: readFileSync(join(__dirname, '../../templates/ini_h005_en.hbs'), { encoding: 'utf8' }),
		});

		const letter = await generator.generate();
		const digestHex = Buffer.from(Crypto.digestCertificate(h005Keys.a()), 'base64').toString('hex').toUpperCase();
		const expectedDigest = digestHex.match(/.{1,2}/g).join(' ');

		assert.include(letter, expectedDigest);
	});

	it('shows "unlimited" for a certificate with EBICS 3.0\'s unlimited-validity convention (9999-12-31)', async () => {
		// h005Client._generateKeys uses Keys.generate('h005')'s default
		// validityYears (5), not 'unlimited' - use a duck-typed client whose
		// keys() resolves to a key generated with the unlimited option
		// instead, so this still goes through BankLetter#generate() (and
		// therefore certValidUntil) rather than compiling the template by hand.
		const unlimitedKey = Key.generateWithCertificate('signature', { validityYears: 'unlimited' });
		const unlimitedClient = {
			userId: 'USER1',
			partnerId: 'PARTNER1',
			keys: async () => ({
				a: () => unlimitedKey, x: () => unlimitedKey, e: () => unlimitedKey,
			}),
		};

		const generator = new BankLetter({
			client: unlimitedClient,
			bankName: 'Test Bank AG',
			template: readFileSync(join(__dirname, '../../templates/ini_h005_en.hbs'), { encoding: 'utf8' }),
		});

		const letter = await generator.generate();

		assert.include(letter, 'unlimited');
		assert.notInclude(letter, '9999');
	});
});
