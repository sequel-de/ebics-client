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

const xmlLintWasm = require('xmllint-wasm');

// Validates a generated request against the real, bundled EBICS 3.0 (H005)
// schema family (test/xsd/ebics_H005.xsd and its includes - see
// test/xsd/README.md for provenance). This is the same rigor
// test/spec/H004.js applies to H004 requests, and closes the gap an earlier
// version of this suite had (structural-only assertions): every INI/HIA/HPB
// request below is now schema-valid, not just shaped-like-it-should-be. This
// implementation has additionally been validated live against PostFinance's
// EBICS 3.0 ISO test environment (INI, HIA and HPB all returned EBICS_OK).
const validateXML = (() => {
	const xsdDir = path.resolve(__dirname, '../xsd');
	const rootFile = 'ebics_H005.xsd';
	const schemaDoc = fs.readFileSync(path.join(xsdDir, rootFile), 'utf8');
	const preload = fs
		.readdirSync(xsdDir)
		.filter(file => file.endsWith('.xsd') && file !== rootFile)
		.map(file => ({
			fileName: file,
			contents: fs.readFileSync(path.join(xsdDir, file), {
				encoding: 'utf8',
			}),
		}));

	return async (str) => {
		const results = await xmlLintWasm.validateXML({
			xml: [{ fileName: 'ebics.xml', contents: str }],
			schema: [{ fileName: rootFile, contents: schemaDoc }],
			preload,
		});
		return results.valid;
	};
})();

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
		assert.isTrue(await validateXML(xml));
	});

	it('serializes and signs an HIA request as ebicsUnsecuredRequest', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.HIA);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsUnsecuredRequest');
		assert.include(xml, '<AdminOrderType>HIA</AdminOrderType>');
		assert.isTrue(await validateXML(xml));
	});

	it('serializes and signs an HPB request as ebicsNoPubKeyDigestsRequest, with a populated XML-DSIG signature', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.HPB);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsNoPubKeyDigestsRequest');
		assert.match(xml, /<ds:DigestValue>[^<]+<\/ds:DigestValue>/);
		assert.match(xml, /<ds:SignatureValue>[^<]+<\/ds:SignatureValue>/);
		assert.isTrue(await validateXML(xml));
	});

	it('parses a bank HPB response into certificate-backed bank keys, and computes the H005 bank-key digest correctly', async () => {
		// Simulate a bank's HPBResponseOrderData: two certificates (X002/E002),
		// in the ds:X509Data shape our own HIA serializer produces. Confirmed
		// against the real ebics_types_H005.xsd: AuthenticationPubKeyInfoType/
		// EncryptionPubKeyInfoType extend PubKeyInfoType ({ ds:X509Data })
		// directly - unlike H004, there is no 'PubKeyValue' wrapper element.
		const bankX002 = Key.generateWithCertificate('authentication', { commonName: 'HOST1' });
		const bankE002 = Key.generateWithCertificate('encryption', { commonName: 'HOST1' });

		// Field order/shape confirmed against the real HPBResponseOrderDataType
		// (ebics_orders_H005.xsd): AuthenticationPubKeyInfo,
		// EncryptionPubKeyInfo, then HostID - NOT PartnerID/UserID (that's the
		// H004 shape). SignaturePubKeyInfo is declared but minOccurs=0
		// maxOccurs=0, i.e. never actually present.
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
  <HostID>HOST1</HostID>
</HPBResponseOrderData>`;

		// The fixture itself should be schema-valid - HPBResponseOrderData is
		// defined in ebics_orders_H005.xsd, included by the same umbrella
		// schema (ebics_H005.xsd) used above.
		assert.isTrue(await validateXML(orderDataXml));

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
