'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const { DOMParser } = require('@xmldom/xmldom');
const AdmZip = require('adm-zip');

const ebics = require('../../');
const Key = require('../../lib/keymanagers/Key');
const Crypto = require('../../lib/crypto/Crypto');
const utils = require('../../lib/utils');
const H005Response = require('../../lib/orders/H005/response');
const serializerMiddleware = require('../../lib/middleware/serializer');

const xmlLintWasm = require('xmllint-wasm');

// Validates a generated request against the real, bundled EBICS 3.0 (H005)
// schema family (test/xsd/ebics_H005.xsd and its includes).
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
  <HostID>HOST1</HostID>
</HPBResponseOrderData>`;

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

		// SHA-256 over the raw certificate DER bytes, base64-encoded.
		const expectedDigest = crypto
			.createHash('sha256')
			.update(bankX002.certificateDer())
			.digest('base64')
			.trim();

		assert.strictEqual(Crypto.digestCertificate(keysWithBank.bankX()), expectedDigest);
	});

	it('rejects the upload (BTU) operation, which is not yet implemented', async () => {
		try {
			await serializerMiddleware.use({ version: 'h005', operation: 'upload', orderDetails: {} }, client);
			assert.fail('expected serializer.use() to throw for an unimplemented H005 operation');
		} catch (e) {
			assert.match(e.message, /does not yet implement/);
		}
	});
});

describe('H005 (EBICS 3.0) BTD business order download', () => {
	const keyPath = path.join(os.tmpdir(), `h005-btd-test-keys-${process.pid}-${Date.now()}.key`);
	let client;

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

		// BTD's header needs the bank's keys already on file, unlike INI/HIA/HPB.
		await client.setBankKeys({
			bankX002: { cert: Key.generateWithCertificate('authentication', { commonName: 'HOST1' }).toCertPem() },
			bankE002: { cert: Key.generateWithCertificate('encryption', { commonName: 'HOST1' }).toCertPem() },
		});
	});

	after(() => {
		if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
	});

	it('Orders.H005.Z53 is an h005-versioned BTD download order definition', () => {
		const order = ebics.Orders.H005.Z53();

		assert.strictEqual(order.version, 'h005');
		assert.strictEqual(order.operation, 'download');
		assert.strictEqual(order.orderDetails.AdminOrderType, 'BTD');
		assert.strictEqual(order.orderDetails.BTDOrderParams.Service.ServiceName, 'EOP');
	});

	it('serializes a BTD (camt.053 statement) download request as ebicsRequest, schema-valid against the real EBICS 3.0 schema', async () => {
		const order = ebics.Orders.H005.Z53('2024-01-01', '2024-01-31');
		const xml = await client.signOrder(order);
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsRequest');
		assert.include(xml, '<AdminOrderType>BTD</AdminOrderType>');
		assert.include(xml, '<ServiceName>EOP</ServiceName>');
		assert.include(xml, '<Scope>CH</Scope>');
		assert.include(xml, 'containerType="ZIP"');
		assert.include(xml, '<MsgName version="08">camt.053</MsgName>');
		assert.include(xml, '<Start>2024-01-01</Start>');
		assert.include(xml, '<End>2024-01-31</End>');
		assert.isTrue(await validateXML(xml));
	});

	it('omits DateRange when no start/end is given, and still validates', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.Z53());

		assert.notInclude(xml, '<DateRange>');
		assert.isTrue(await validateXML(xml));
	});

	it('accepts a scope/msgVersion override for non-Swiss BTF conventions (e.g. Germany also uses EOP/camt.053, under Scope=DE)', async () => {
		const order = ebics.Orders.H005.Z53(null, null, { scope: 'DE', msgVersion: '04' });

		assert.strictEqual(order.orderDetails.BTDOrderParams.Service.Scope, 'DE');

		const xml = await client.signOrder(order);
		assert.include(xml, '<Scope>DE</Scope>');
		assert.include(xml, '<MsgName version="04">camt.053</MsgName>');
		assert.isTrue(await validateXML(xml));
	});

	it('accepts a full serviceName/scope/msgName/msgVersion override for an entirely different BTF row', async () => {
		const order = ebics.Orders.H005.Z53(null, null, {
			serviceName: 'STM', scope: 'CH', msgName: 'camt.052', msgVersion: '08',
		});

		assert.strictEqual(order.orderDetails.BTDOrderParams.Service.ServiceName, 'STM');

		const xml = await client.signOrder(order);
		assert.include(xml, '<ServiceName>STM</ServiceName>');
		assert.include(xml, '<MsgName version="08">camt.052</MsgName>');
		assert.isTrue(await validateXML(xml));
	});

	it('omits the Container element entirely when container: false is passed, for a market/message that does not use one', async () => {
		const order = ebics.Orders.H005.Z53(null, null, { container: false });

		assert.isUndefined(order.orderDetails.BTDOrderParams.Service.Container);

		const xml = await client.signOrder(order);
		assert.notInclude(xml, '<Container');
		assert.isTrue(await validateXML(xml));
	});

	it('decrypts and unzips a simulated BTD response back to the original camt.053 content', async () => {
		const keys = await client.keys();
		const zip = new AdmZip();
		const statementXml = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><statement/></Document>';
		zip.addFile('camt.053.xml', Buffer.from(statementXml));

		const transactionKey = crypto.randomBytes(16);
		const iv = Buffer.from(Array(16).fill(0));
		const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, iv).setAutoPadding(false);
		const encryptedOrderData = Buffer.concat([
			cipher.update(Crypto.pad(zlib.deflateSync(zip.toBuffer()))),
			cipher.final(),
		]).toString('base64');

		const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<ebicsResponse xmlns="urn:org:ebics:H005">
  <header authenticate="true">
    <static><TransactionID>TESTTRANSACTIONID</TransactionID></static>
    <mutable><TransactionPhase>Initialisation</TransactionPhase></mutable>
  </header>
  <body>
    <DataTransfer>
      <DataEncryptionInfo authenticate="true">
        <EncryptionPubKeyDigest Version="E002" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">${Crypto.digestPublicKey(keys.e())}</EncryptionPubKeyDigest>
        <TransactionKey>${Crypto.publicEncrypt(keys.e(), transactionKey).toString('base64')}</TransactionKey>
      </DataEncryptionInfo>
      <OrderData>${encryptedOrderData}</OrderData>
    </DataTransfer>
    <ReturnCode>000000</ReturnCode>
  </body>
</ebicsResponse>`;

		const response = H005Response(responseXml, keys);
		const entries = utils.unzip(response.orderData());

		assert.lengthOf(entries, 1);
		assert.strictEqual(entries[0].name, 'camt.053.xml');
		assert.strictEqual(entries[0].data.toString(), statementXml);
	});
});
