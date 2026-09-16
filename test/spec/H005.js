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

	it('rejects an operation H005 does not support', async () => {
		try {
			await serializerMiddleware.use({ version: 'h005', operation: 'nonsense', orderDetails: {} }, client);
			assert.fail('expected serializer.use() to throw for an unsupported H005 operation');
		} catch (e) {
			assert.match(e.message, /does not support/);
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

	it('computes BankPubKeyDigests as the certificate-DER digest (H005), not the modulus/exponent digest (H004)', async () => {
		const xml = await client.signOrder(ebics.Orders.H005.Z53());
		const keys = await client.keys();

		const expectedAuth = Crypto.digestCertificate(keys.bankX());
		const expectedEnc = Crypto.digestCertificate(keys.bankE());

		assert.include(xml, `<Authentication Version="X002" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">${expectedAuth}</Authentication>`);
		assert.include(xml, `<Encryption Version="E002" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">${expectedEnc}</Encryption>`);
		// The two digest algorithms produce different output for the same
		// cert-backed key (see lib/orders/H005/serializers/download.js) -
		// assert against digestPublicKey too, so a regression back to the
		// wrong algorithm still passes the loose `assert.include` checks
		// above (both are valid-looking base64 strings) but fails here.
		assert.notInclude(xml, Crypto.digestPublicKey(keys.bankX()));
		assert.notInclude(xml, Crypto.digestPublicKey(keys.bankE()));
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

describe('H005 (EBICS 3.0) BTU business order upload', () => {
	const keyPath = path.join(os.tmpdir(), `h005-btu-test-keys-${process.pid}-${Date.now()}.key`);
	let client;
	let bankE002; // kept as a Key (not just the cert pem) so tests can RSA-decrypt TransactionKey below

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

		bankE002 = Key.generateWithCertificate('encryption', { commonName: 'HOST1' });
		await client.setBankKeys({
			bankX002: { cert: Key.generateWithCertificate('authentication', { commonName: 'HOST1' }).toCertPem() },
			bankE002: { cert: bankE002.toCertPem() },
		});
	});

	after(() => {
		if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
	});

	it('Orders.H005.CCT is an h005-versioned BTU upload order definition, defaulting to Swiss MCT/CH/pain.001 v09', () => {
		const order = ebics.Orders.H005.CCT('<Document/>');

		assert.strictEqual(order.version, 'h005');
		assert.strictEqual(order.operation, 'upload');
		assert.strictEqual(order.orderDetails.AdminOrderType, 'BTU');
		assert.strictEqual(order.orderDetails.BTUOrderParams.Service.ServiceName, 'MCT');
		assert.strictEqual(order.orderDetails.BTUOrderParams.Service.Scope, 'CH');
		assert.strictEqual(order.orderDetails.BTUOrderParams.Service.MsgName['@'].version, '09');
		assert.strictEqual(order.orderDetails.BTUOrderParams.Service.MsgName['#'], 'pain.001');
		assert.strictEqual(order.document, '<Document/>');
	});

	it('serializes a BTU (pain.001 credit transfer) upload request as ebicsRequest, schema-valid, with no fileName/Container by default but SignatureFlag always present', async () => {
		const document = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn/></Document>';
		const xml = await client.signOrder(ebics.Orders.H005.CCT(document));
		const doc = new DOMParser().parseFromString(xml, 'text/xml');

		assert.strictEqual(doc.documentElement.tagName, 'ebicsRequest');
		assert.include(xml, '<AdminOrderType>BTU</AdminOrderType>');
		assert.include(xml, '<ServiceName>MCT</ServiceName>');
		assert.include(xml, '<Scope>CH</Scope>');
		assert.include(xml, '<MsgName version="09">pain.001</MsgName>');
		assert.notInclude(xml, 'fileName=');
		assert.notInclude(xml, '<Container');
		// SignatureFlag's absence specifically means "no ES, authorise
		// outside EBICS" per the H005 schema's own documentation (see
		// lib/predefinedOrders/h005/CCT.js) - since upload.js always embeds
		// a real ES, the flag must always be present, just empty by default
		// (no requestEDS attribute) rather than omitted.
		assert.include(xml, '<SignatureFlag/>');
		assert.isTrue(await validateXML(xml));
	});

	it('includes a Container element when container: "ZIP" is explicitly requested, for a bank/market whose BTF catalog supports it', async () => {
		const document = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn/></Document>';
		const order = ebics.Orders.H005.CCT(document, { container: 'ZIP' });
		const xml = await client.signOrder(order);

		assert.strictEqual(order.orderDetails.BTUOrderParams.Service.Container['@'].containerType, 'ZIP');
		assert.include(xml, 'containerType="ZIP"');
		assert.isTrue(await validateXML(xml));
	});

	it('computes DataDigest as the SHA-256 digest of the newline-stripped document, base64-encoded, by default (no container)', async () => {
		const document = '<Document>\n  <Foo/>\n</Document>';
		const xml = await client.signOrder(ebics.Orders.H005.CCT(document));

		const expectedDigest = crypto.createHash('sha256').update(document.replace(/\n|\r/g, '')).digest('base64').trim();

		assert.include(xml, `<DataDigest SignatureVersion="A006">${expectedDigest}</DataDigest>`);
	});

	it('computes DataDigest as the SHA-256 digest of the ZIP-wrapped document, base64-encoded, when container: "ZIP" is explicitly requested', async () => {
		const document = '<Document>\n  <Foo/>\n</Document>';
		const xml = await client.signOrder(ebics.Orders.H005.CCT(document, { container: 'ZIP' }));

		const expectedDigest = crypto.createHash('sha256').update(utils.zip('document.xml', document)).digest('base64').trim();

		assert.include(xml, `<DataDigest SignatureVersion="A006">${expectedDigest}</DataDigest>`);
	});

	it('uses fileName as the ZIP entry name when both fileName and container: "ZIP" are set', async () => {
		const document = '<Document/>';
		const xml = await client.signOrder(ebics.Orders.H005.CCT(document, { fileName: 'payments.xml', container: 'ZIP' }));

		const expectedDigest = crypto.createHash('sha256').update(utils.zip('payments.xml', document)).digest('base64').trim();

		assert.include(xml, `<DataDigest SignatureVersion="A006">${expectedDigest}</DataDigest>`);
	});

	it('includes fileName as an attribute, and adds requestEDS="true" to SignatureFlag only when explicitly requested', async () => {
		const order = ebics.Orders.H005.CCT('<Document/>', { fileName: 'payments.xml', requestEDS: true });
		const xml = await client.signOrder(order);

		assert.include(xml, 'fileName="payments.xml"');
		assert.include(xml, '<SignatureFlag requestEDS="true"');
		assert.isTrue(await validateXML(xml));
	});

	it('treats requestEDS: false the same as the default (SignatureFlag present but empty) - "true" is the only value the schema allows for the attribute', async () => {
		const order = ebics.Orders.H005.CCT('<Document/>', { requestEDS: false });
		const xml = await client.signOrder(order);

		assert.include(xml, '<SignatureFlag/>');
		assert.notInclude(xml, 'requestEDS');
		assert.isTrue(await validateXML(xml));
	});

	it('accepts a full serviceName/scope/msgName/msgVersion/container override for a different market/message (e.g. a Germany pain.008 direct debit)', async () => {
		const order = ebics.Orders.H005.CCT('<Document/>', {
			serviceName: 'SDD', scope: 'DE', msgName: 'pain.008', msgVersion: '02', container: 'ZIP',
		});
		const xml = await client.signOrder(order);

		assert.include(xml, '<ServiceName>SDD</ServiceName>');
		assert.include(xml, '<Scope>DE</Scope>');
		assert.include(xml, '<MsgName version="02">pain.008</MsgName>');
		assert.include(xml, 'containerType="ZIP"');
		assert.isTrue(await validateXML(xml));
	});

	// Shared by both round-trip tests below: signs the order for both phases and
	// returns the decrypted, inflated OrderData bytes the bank would end up with.
	const roundTripOrderData = async (order) => {
		// Initialisation phase: TransactionKey is the AES key, RSA-encrypted to the bank's E002 key.
		const initXml = await client.signOrder(order);
		const initDoc = new DOMParser().parseFromString(initXml, 'text/xml');
		const transactionKeyB64 = initDoc.getElementsByTagName('TransactionKey')[0].textContent;
		const transactionKey = Crypto.privateDecrypt(bankE002, Buffer.from(transactionKeyB64, 'base64'));

		// Transfer phase: same as the real client.upload() flow (lib/Client.js), which sets
		// order.transactionId from the bank's Initialisation response before re-signing.
		order.transactionId = 'TESTTRANSACTIONID';
		const transferXml = await client.signOrder(order);
		const transferDoc = new DOMParser().parseFromString(transferXml, 'text/xml');
		const orderDataB64 = transferDoc.getElementsByTagName('OrderData')[0].textContent;

		const decipher = crypto.createDecipheriv('aes-128-cbc', transactionKey, Buffer.alloc(16, 0)).setAutoPadding(false);
		const padded = Buffer.concat([decipher.update(Buffer.from(orderDataB64, 'base64')), decipher.final()]);
		const unpadded = padded.slice(0, padded.length - padded[padded.length - 1]);

		return zlib.inflateSync(unpadded);
	};

	it('carries the document through Initialisation and Transfer phases as plain XML by default, so the bank can decrypt back the original bytes', async () => {
		const document = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn>test</CstmrCdtTrfInitn></Document>';
		const orderData = await roundTripOrderData(ebics.Orders.H005.CCT(document));

		assert.strictEqual(orderData.toString(), document.replace(/\n|\r/g, ''));
	});

	it('carries the document through Initialisation and Transfer phases, ZIP-wrapped, when container: "ZIP" is explicitly requested', async () => {
		const document = '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn>test</CstmrCdtTrfInitn></Document>';
		const orderData = await roundTripOrderData(ebics.Orders.H005.CCT(document, { container: 'ZIP' }));

		const entries = utils.unzip(orderData);
		assert.lengthOf(entries, 1);
		assert.strictEqual(entries[0].name, 'document.xml');
		assert.strictEqual(entries[0].data.toString(), document);
	});
});
