'use strict';

const zlib = require('zlib');
const crypto = require('crypto');

const js2xmlparser = require('js2xmlparser');

const Crypto = require('../../../crypto/Crypto');
const utils = require('../../../utils');

const downloadSerializer = require('./download');

const transKey = crypto.randomBytes(16);

// The exact bytes that get deflated/encrypted and sent as OrderData: the
// raw document as-is when ZIP-wrapped (utils.zip() below), or the same
// newline-stripped raw XML as before when it isn't. Computed once and
// reused for both the digest (Initialisation phase) and the encrypted
// transfer (Transfer phase), so they're guaranteed to describe the same
// content - see utils.zip()'s determinism note.
const orderDataBytes = (document, container, fileName) => {
	if (container === 'ZIP')
		return utils.zip(fileName || 'document.xml', document);
	return Buffer.from(document.replace(/\n|\r/g, ''), 'utf8');
};

// Digest of the exact bytes the bank will end up with after decrypting
// OrderData in the transfer phase (see orderDataBytes()).
const documentDigest = data => Crypto.digestWithHash(data);

const signatureValue = (digest, key) => Crypto.sign(key, digest);

// The S002 signature payload (OrderSignatureDataType: SignatureVersion,
// SignatureValue, PartnerID, UserID, optional ds:X509Data) is byte-for-byte
// identical to H004's S001 - only the namespace/schemaLocation differ (see
// docs/EBICS-3.0-H005.md), so this otherwise mirrors H004's upload.js
// orderSignature() exactly.
const orderSignature = (ebicsAccount, digest, key, xmlOptions) => {
	const xmlObj = {
		'@': {
			xmlns: 'http://www.ebics.org/S002',
			'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'xsi:schemaLocation': 'http://www.ebics.org/S002 http://www.ebics.org/S002/ebics_signature.xsd',
		},
		OrderSignatureData: {
			SignatureVersion: 'A006',
			SignatureValue: signatureValue(digest, key),
			PartnerID: ebicsAccount.partnerId,
			UserID: ebicsAccount.userId,
		},
	};

	return js2xmlparser.parse('UserSignatureData', xmlObj, xmlOptions);
};

const encryptedOrderSignature = (ebicsAccount, digest, transactionKey, key, xmlOptions) => {
	const dst = zlib.deflateSync(orderSignature(ebicsAccount, digest, key, xmlOptions));
	const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).setAutoPadding(false);

	return Buffer.concat([cipher.update(Crypto.pad(dst)), cipher.final()]).toString('base64');
};

const encryptedOrderData = (data, transactionKey) => {
	const dst = zlib.deflateSync(data);
	const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).setAutoPadding(false);

	return Buffer.concat([cipher.update(Crypto.pad(dst)), cipher.final()]).toString('base64');
};

// BTU (upload)'s header/DataTransfer shape mirrors H004's upload.js - same
// AES-128-CBC transaction-key encryption for both the signature and the
// order data, same two-phase (Initialisation/Transfer) flow via
// downloadSerializer.use(). orderDetails (AdminOrderType/BTUOrderParams) is
// built by the caller - see lib/predefinedOrders/h005/.
//
// One real (not just namespace-deep) difference from H004: H005's
// DataTransferRequestType adds a required DataDigest element after
// SignatureData - the plain (unsigned, unencrypted) hash of the order
// data, so the bank can verify what it decrypts in the transfer phase
// against what the client declared upfront, independent of the ES
// signature itself. It's the same digest that gets RSA-PSS-signed into
// SignatureValue, just also sent as its own element - and unlike
// DataEncryptionInfo/SignatureData, the schema gives DataDigest no
// authenticate attribute to set (ebics:AuthenticationMarker isn't
// applied to it), so it's plain content, not part of the XML-DSIG
// reference the way those two are.
module.exports = {
	async use(order, client) {
		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};
		const {
			transactionId, document, container, fileName,
		} = order;
		const {
			rootName, xmlOptions, xmlSchema, transfer,
		} = await downloadSerializer.use(order, client);

		this.rootName = rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;
		this.transfer = transfer;

		const data = orderDataBytes(document, container, fileName);

		if (transactionId) return this.transfer(encryptedOrderData(data, transKey));

		const digest = documentDigest(data);

		this.xmlSchema.header.static.NumSegments = 1;
		this.xmlSchema.body = {
			DataTransfer: {
				DataEncryptionInfo: {
					'@': { authenticate: true },
					EncryptionPubKeyDigest: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestCertificate(keys.bankE()),
					},
					TransactionKey: Crypto.publicEncrypt(keys.bankE(), transKey).toString('base64'),
				},
				SignatureData: {
					'@': { authenticate: true },
					'#': encryptedOrderSignature(ebicsAccount, digest, transKey, keys.a(), this.xmlOptions),
				},
				DataDigest: {
					'@': { SignatureVersion: 'A006' },
					'#': digest.toString('base64'),
				},
			},
		};

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
