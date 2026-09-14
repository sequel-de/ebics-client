'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const { DOMParser } = require('@xmldom/xmldom');

const ebics = require('../../');
const Key = require('../../lib/keymanagers/Key');
const Crypto = require('../../lib/crypto/Crypto');
const H005Response = require('../../lib/orders/H005/response');
const serializerMiddleware = require('../../lib/middleware/serializer');

// NOTE ON TEST COVERAGE: unlike test/spec/H004.js, this suite can't validate
// generated XML against a real ebics_*_H005.xsd - no H005 schema is bundled
// under test/xsd (only H004's). The assertions below are therefore
// structural (namespace, root element, expected fields present, values
// round-trip correctly) rather than full schema validation. See
// node-ebics-client-h005-scoping.md for what would close that gap, and
// treat this suite as a floor, not a substitute for validating against a
// real EBICS 3.0 schema or bank test environment before production use.

describe('H005 (EBICS 3.0) key management', () => {
	const keyPath = path.join(os.tmpdir(), `h005-test-keys-${process.pid}-${Date.now()}.key`);
	let client;
	let keys;

	before(async () => {
		client = new ebics.Client({
			url: 'https://example-bank.test/ebicsweb',
			partnerId: 'PARTNER1',
			userId: 'USER1',
			hostId: 'HOST1',
			passphrase: 'test',
			keyStorage: ebics.fsKeysStorage(keyPath),
		});

		await client._generateKeys('h005'); // eslint-disable-line no-underscore-dangle
		keys = await client.keys();
	});

	after(() => {
		if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
	});

	it('generates A006/X002/E002 keys each wrapped in a self-signed certificate', () => {
		assert.isTrue(keys.a().hasCertificate());
		assert.isTrue(keys.x().hasCertificate());
		assert.isTrue(keys.e().hasCertificate());
	});

	it('Orders.H005.{INI,HIA,HPB} are h005-versioned order definitions', () => {
		['INI', 'HIA', 'HPB'].forEach((name) => {
			assert.strictEqual(ebics.Orders.H005[name].version, 'h005');
			assert.strictEqual(ebics.Orders.H005[name].operation, 'ini');
		});
	});

	it('serializes and signs an INI request as ebicsUnsecuredRequest with an X.509 SignaturePubKeyOrderData', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.INI);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsUnsecuredRequest');
		assert.strictEqual(doc.documentElement.getAttribute('xmlns'), 'urn:org:ebics:H005');
		assert.strictEqual(doc.documentElement.getAttribute('Version'), 'H005');
		assert.include(xml, '<AdminOrderType>INI</AdminOrderType>');
		assert.notInclude(xml, '<OrderType>');
		assert.notInclude(xml, '<OrderAttribute>');
	});

	it('serializes and signs an HIA request as ebicsUnsecuredRequest', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.HIA);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsUnsecuredRequest');
		assert.include(xml, '<AdminOrderType>HIA</AdminOrderType>');
	});

	it('serializes and signs an HPB request as ebicsNoPubKeyDigestsRequest, with a populated XML-DSIG signature', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.HPB);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsNoPubKeyDigestsRequest');
		assert.match(xml, /<ds:DigestValue>[^<]+<\/ds:DigestValue>/);
		assert.match(xml, /<ds:SignatureValue>[^<]+<\/ds:SignatureValue>/);
	});

	it('parses a bank HPB response into certificate-backed bank keys, and computes the H005 bank-key digest correctly', async () => {
		// Simulate a bank's HPBResponseOrderData: two certificates (X002/E002),
		// in the ds:X509Data shape our own HIA serializer produces. Confirmed
		// against the real ebics_types_H005.xsd: AuthenticationPubKeyInfoType/
		// EncryptionPubKeyInfoType extend PubKeyInfoType ({ ds:X509Data })
		// directly - unlike H004, there is no 'PubKeyValue' wrapper element.
		const bankX002 = Key.generateWithCertificate('authentication', { commonName: 'HOST1' });
		const bankE002 = Key.generateWithCertificate('encryption', { commonName: 'HOST1' });

		const orderDataXml = `<?xml version="1.0" encoding="UTF-8"?>
<HPBResponseOrderData xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns="urn:org:ebics:H005">
  <AuthenticationPubKeyInfo>
    <ds:X509Data><ds:X509Certificate>${bankX002.certificateDer().toString('base64')}</ds:X509Certificate></ds:X509Data>
    <AuthenticationVersion>X002</AuthenticationVersion>
  </AuthenticationPubKeyInfo>
  <EncryptionPubKeyInfo>
    <ds:X509Data><ds:X509Certificate>${bankE002.certificateDer().toString('base64')}</ds:X509Certificate></ds:X509Data>
    <EncryptionVersion>E002</EncryptionVersion>
  </EncryptionPubKeyInfo>
  <PartnerID>PARTNER1</PartnerID>
  <UserID>USER1</UserID>
</HPBResponseOrderData>`;

		const fakeResponse = H005Response('<a/>', keys);
		fakeResponse.orderData = () => orderDataXml;

		const parsedBankKeys = fakeResponse.bankKeys();
		assert.isString(parsedBankKeys.bankX002.cert);
		assert.isString(parsedBankKeys.bankE002.cert);

		await client.setBankKeys(parsedBankKeys);
		const keysWithBank = await client.keys();

		assert.isTrue(keysWithBank.bankX().hasCertificate());
		assert.isTrue(keysWithBank.bankE().hasCertificate());

		// The H005 bank-key digest is SHA-256 over the raw certificate DER
		// bytes (base64-encoded) - not H004's hash-of-modulus-and-exponent.
		// Verified against the EBICS Common Implementation Guide's own worked
		// example in an earlier standalone check; here we confirm it's wired
		// correctly end to end (round-tripped cert -> same digest as computed
		// directly from the original certificate DER).
		const expectedDigest = crypto
			.createHash('sha256')
			.update(bankX002.certificateDer())
			.digest('base64')
			.trim();

		assert.strictEqual(Crypto.digestCertificate(keysWithBank.bankX()), expectedDigest);
	});

	it('rejects business order operations (upload/download) until the BTF schema is confirmed', async () => {
		try {
			await serializerMiddleware.use({ version: 'h005', operation: 'download', orderDetails: {} }, client);
			assert.fail('expected serializer.use() to throw for an unimplemented H005 operation');
		} catch (e) {
			assert.match(e.message, /does not yet implement/);
		}
	});
});
