'use strict';

const zlib = require('zlib');

const js2xmlparser = require('js2xmlparser');

const Crypto = require('../../../crypto/Crypto');

const genericSerializer = require('./generic');

// EBICS 3.0 (H005) replaces the H004 key-management order data's
// 'ds:RSAKeyValue' (raw modulus/exponent) with an X.509 certificate wrapping
// the same public key, carried as the standard xmldsig 'ds:X509Data' ->
// 'ds:X509Certificate' structure - confirmed in the EBICS Common
// Implementation Guide (based on EBICS 3.0), section 2.4.1.2: "these XML
// types contain elements of type RSAKeyValue or X509Data" (H004 vs H005).
const x509KeyValue = key => ({
	'ds:X509Data': {
		'ds:X509Certificate': key.certificateDer().toString('base64'),
	},
});

// NOTE ON PROVENANCE: the H004 SignaturePubKeyOrderData namespace is
// 'http://www.ebics.org/S001' (schema ebics_signature.xsd). For H005, this
// namespace changes to 'http://www.ebics.org/S002' - this specific string is
// NOT stated in the EBICS Common Implementation Guide (the business-rules
// document this port is otherwise grounded in); it is taken from a secondary
// mirror of the EBICS 3.0 base specification and should be confirmed against
// the actual ebics_signature_H005.xsd (or empirically, e.g. against
// isotest.postfinance.ch) before production use.
const SIGNATURE_SCHEMA_NAMESPACE_H005 = 'http://www.ebics.org/S002';

const keySignature = (ebicsAccount, key, xmlOptions) => {
	const xmlOrderData = {
		'@': {
			'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
			xmlns: SIGNATURE_SCHEMA_NAMESPACE_H005,
		},
		SignaturePubKeyInfo: {
			PubKeyValue: {
				...x509KeyValue(key),
				TimeStamp: Crypto.timestamp(),
			},
			SignatureVersion: 'A006',
		},
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
	};

	return js2xmlparser.parse('SignaturePubKeyOrderData', xmlOrderData, xmlOptions);
};
const orderData = (ebicsAccount, keys, xmlOptions) => {
	const xmlOrderData = {
		'@': {
			'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
			xmlns: 'urn:org:ebics:H005',
		},
		AuthenticationPubKeyInfo: {
			PubKeyValue: x509KeyValue(keys.x()),
			AuthenticationVersion: 'X002',
		},
		EncryptionPubKeyInfo: {
			PubKeyValue: x509KeyValue(keys.e()),
			EncryptionVersion: 'E002',
		},
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
	};

	return js2xmlparser.parse('HIARequestOrderData', xmlOrderData, xmlOptions);
};
const commonHeader = (ebicsAccount, orderDetails, productString) => ({
	'@': { authenticate: true },
	static: {
		HostID: ebicsAccount.hostId,
		Nonce: Crypto.nonce(),
		Timestamp: Crypto.timestamp(),
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
		Product: {
			'@': { Language: 'en' },
			'#': productString,
		},
		OrderDetails: orderDetails,
		SecurityMedium: '0000',
	},
	mutable: {},
});
const process = {
	INI: {
		rootName: 'ebicsUnsecuredRequest',
		header: (ebicsAccount, orderDetails, productString) => {
			const ch = commonHeader(ebicsAccount, orderDetails, productString);

			delete ch.static.Nonce;
			delete ch.static.Timestamp;

			return ch;
		},
		body: (ebicsAccount, keys, xmlOptions) => ({
			DataTransfer: {
				OrderData: Buffer.from(zlib.deflateSync(keySignature(ebicsAccount, keys.a(), xmlOptions))).toString('base64'),
			},
		}),
	},
	HIA: {
		rootName: 'ebicsUnsecuredRequest',
		header: (ebicsAccount, orderDetails, productString) => {
			const ch = commonHeader(ebicsAccount, orderDetails, productString);

			delete ch.static.Nonce;
			delete ch.static.Timestamp;

			return ch;
		},
		body: (ebicsAccount, keys, xmlOptions) => ({
			DataTransfer: {
				OrderData: Buffer.from(zlib.deflateSync(orderData(ebicsAccount, keys, xmlOptions))).toString('base64'),
			},
		}),
	},
	HPB: {
		rootName: 'ebicsNoPubKeyDigestsRequest',
		header: (ebicsAccount, orderDetails, productString) => commonHeader(ebicsAccount, orderDetails, productString),
		body: () => ({}),
	},
};

module.exports = {
	async use(order, client) {
		const keys = await client.keys();
		const { orderDetails, transactionId } = order;
		const { xmlOptions, xmlSchema, productString } = genericSerializer(client.host, transactionId);
		const orderType = orderDetails.OrderType.toUpperCase();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};

		this.rootName = process[orderType].rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;

		this.xmlSchema.header = process[orderType].header(ebicsAccount, orderDetails, productString);
		this.xmlSchema.body = process[orderType].body(ebicsAccount, keys, this.xmlOptions);

		if (orderType !== 'HPB' && Object.prototype.hasOwnProperty.call(this.xmlSchema, 'AuthSignature'))
			delete this.xmlSchema.AuthSignature;

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
