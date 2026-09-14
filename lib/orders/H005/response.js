'use strict';

const zlib = require('zlib');
const crypto = require('crypto');
const forge = require('node-forge');

const Crypto = require('../../crypto/Crypto');

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const errors = require('./errors');

const DEFAULT_IV = Buffer.from(Array(16).fill(0, 0, 15));
const NS = 'urn:org:ebics:H005';

const lastChild = (node) => {
	let y = node.lastChild;

	while (y.nodeType !== 1) y = y.previousSibling;

	return y;
};

// Wraps a raw base64 DER certificate (as carried in a ds:X509Certificate
// element) in PEM armor, for Key.fromCertificate()/forge.pki.certificateFromPem().
const derBase64ToPem = base64Der => forge.pem.encode({
	type: 'CERTIFICATE',
	body: Buffer.from(base64Der, 'base64').toString('binary'),
});

module.exports = (xml, keys) => ({
	keys,
	doc: new DOMParser().parseFromString(xml, 'text/xml'),

	isSegmented() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc,
		);

		return !!node.length;
	},

	isLastSegment() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			"//xmlns:header/xmlns:mutable/*[@lastSegment='true']",
			this.doc,
		);

		return !!node.length;
	},

	orderData() {
		const orderDataNode = this.doc.getElementsByTagNameNS(NS, 'OrderData');

		if (!orderDataNode.length) return {};

		const orderData = orderDataNode[0].textContent;
		const decipher = crypto
			.createDecipheriv('aes-128-cbc', this.transactionKey(), DEFAULT_IV)
			.setAutoPadding(false);
		const data = Buffer.from(
			decipher.update(orderData, 'base64', 'binary')
				+ decipher.final('binary'),
			'binary',
		);

		return zlib.inflateSync(data);
	},

	transactionKey() {
		const keyNodeText = this.doc.getElementsByTagNameNS(
			NS,
			'TransactionKey',
		)[0].textContent;
		return Crypto.privateDecrypt(
			this.keys.e(),
			Buffer.from(keyNodeText, 'base64'),
		);
	},

	transactionId() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:TransactionID',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	orderId() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			'.//xmlns:header/xmlns:mutable/xmlns:OrderID',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	businessCode() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select('//xmlns:body/xmlns:ReturnCode', this.doc);

		return node.length ? node[0].textContent : '';
	},

	businessSymbol(code) {
		return errors.business[code].symbol;
	},

	businessShortText(code) {
		return errors.business[code].short_text;
	},

	businessMeaning(code) {
		return errors.business[code].meaning;
	},

	technicalCode() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReturnCode',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	technicalSymbol() {
		const select = xpath.useNamespaces({ xmlns: NS });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReportText',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	technicalShortText(code) {
		return errors.technical[code].short_text;
	},

	technicalMeaning(code) {
		return errors.technical[code].meaning;
	},

	/**
	 * Extracts the bank's public keys from an HPB response's decrypted order
	 * data. EBICS 3.0 (H005) carries each bank key wrapped in a certificate
	 * (ds:X509Data/ds:X509Certificate) rather than as a raw modulus/exponent
	 * pair (H004's ds:RSAKeyValue) - see the EBICS Common Implementation
	 * Guide (based on EBICS 3.0), section 2.4.1.2. Returns
	 * { bankX002: { cert }, bankE002: { cert } }, where `cert` is a
	 * PEM-encoded certificate, matching the shape Keys#setBankKeys() expects
	 * for H005 (see lib/keymanagers/Keys.js's bankKeyOrNull()).
	 */
	bankKeys() {
		const orderData = this.orderData().toString();
		if (!Object.keys(orderData).length) return {};

		const doc = new DOMParser().parseFromString(orderData, 'text/xml');
		const keyNodes = xpath.select("//*[local-name(.)='PubKeyValue']", doc);
		const bankKeys = {};

		if (!keyNodes.length) return {};

		for (let i = 0; i < keyNodes.length; i++) {
			const type = lastChild(keyNodes[i].parentNode).textContent;
			const certNode = xpath.select(
				".//*[local-name(.)='X509Certificate']",
				keyNodes[i],
			)[0];

			if (!certNode) continue; // eslint-disable-line no-continue

			bankKeys[`bank${type}`] = {
				cert: derBase64ToPem(certNode.textContent.trim()),
			};
		}

		return bankKeys;
	},

	toXML() {
		return new XMLSerializer().serializeToString(this.doc);
	},
});
