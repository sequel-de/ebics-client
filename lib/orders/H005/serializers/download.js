'use strict';

const js2xmlparser = require('js2xmlparser');

const Crypto = require('../../../crypto/Crypto');
const genericSerializer = require('./generic');

// Same shape as H004's download.js; only orderDetails differs (BTD's
// AdminOrderType/BTDOrderParams instead of OrderType/StandardOrderParams),
// plus BankPubKeyDigests, which must use H005's certificate-DER digest
// (Crypto.digestCertificate), not H004's modulus/exponent digest
// (Crypto.digestPublicKey) - H005 bank keys are always certificate-backed
// (see lib/keymanagers/Key.js#fromCertificate, used when parsing an HPB
// response). Crypto.digestPublicKey(key) still "works" on a cert-backed
// Key without erroring (Key#e()/#n() extract the embedded public key's
// modulus/exponent regardless of whether it came from a cert), which is
// exactly what let this go unnoticed: it silently produces a real but
// wrong digest instead of failing loudly.
module.exports = {
	async use(order, client) {
		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};
		const { orderDetails, transactionId } = order;
		const {
			rootName, xmlOptions, xmlSchema, receipt, transfer, productString,
		} = genericSerializer(client.hostId, transactionId);

		this.productString = productString;
		this.rootName = rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;
		this.receipt = receipt;
		this.transfer = transfer;

		if (transactionId) return this.receipt();

		this.xmlSchema.header = {
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
				BankPubKeyDigests: {
					Authentication: {
						'@': { Version: 'X002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestCertificate(keys.bankX()),
					},
					Encryption: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestCertificate(keys.bankE()),
					},
				},
				SecurityMedium: '0000',
			},
			mutable: {
				TransactionPhase: 'Initialisation',
			},
		};

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
