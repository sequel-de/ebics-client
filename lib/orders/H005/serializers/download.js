'use strict';

const js2xmlparser = require('js2xmlparser');

const Crypto = require('../../../crypto/Crypto');
const genericSerializer = require('./generic');

// Identical in shape to H004's download.js (lib/orders/H004/serializers/
// download.js) - the static header (HostID/Nonce/Timestamp/PartnerID/UserID/
// Product/OrderDetails/BankPubKeyDigests/SecurityMedium) is unchanged
// between H004 and H005 for a download request; BankPubKeyDigests carries
// only Authentication/Encryption in both (H005's schema forbids a
// Signature digest here outright - ebics_request_H005.xsd's
// BankPubKeyDigests/Signature is minOccurs="0" maxOccurs="0" - and H004's
// download.js never included one either). What differs is entirely inside
// `orderDetails` (AdminOrderType: 'BTD' + a BTDOrderParams/Service BTF
// block instead of OrderType/OrderAttribute/StandardOrderParams) - built
// by the caller (see lib/predefinedOrders/h005/) and passed straight
// through here, same as H004's OrderDetails.
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
						'#': Crypto.digestPublicKey(keys.bankX()),
					},
					Encryption: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestPublicKey(keys.bankE()),
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
