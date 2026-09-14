'use strict';

const constants = require('../../../consts');

// EBICS 3.0 (H005) envelope. The namespace and Version differ from H004
// ('urn:org:ebics:H004' -> 'urn:org:ebics:H005'); everything else about the
// envelope shape (root element name, AuthSignature/XML-DSIG mechanism) is
// unchanged between H004 and H005 - confirmed against the EBICS 3.0
// specification (the XML-DSIG canonicalization/signature/digest algorithms
// and the ebicsRequest root element name are the same across both versions).
const rootName = 'ebicsRequest';
const rootAttributes = {
	'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
	xmlns: 'urn:org:ebics:H005',
	Version: 'H005',
	Revision: '1',
};
const header = {};
const authSignature = ({
	'ds:SignedInfo': {
		'ds:CanonicalizationMethod': {
			'@': {
				Algorithm:
						'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
			},
		},
		'ds:SignatureMethod': {
			'@': {
				Algorithm:
						'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
			},
		},
		'ds:Reference': {
			'@': { URI: "#xpointer(//*[@authenticate='true'])" },
			'ds:Transforms': {
				'ds:Transform': {
					'@': {
						Algorithm:
								'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
					},
				},
			},
			'ds:DigestMethod': {
				'@': {
					Algorithm:
							'http://www.w3.org/2001/04/xmlenc#sha256',
				},
			},
			'ds:DigestValue': {},
		},
	},
	'ds:SignatureValue': {},
});
const body = {};

const xmlOptions = {
	declaration: {
		include: true,
		encoding: 'utf-8',
	},
	format: {
		doubleQuotes: true,
		indent: '',
		newline: '',
		pretty: true,
	},
};

module.exports = (hostId, transactionId) => ({
	productString: constants.productString,
	rootName,
	xmlOptions,
	xmlSchema: {
		'@': rootAttributes,
		header,
		AuthSignature: authSignature,
		body,
	},

	receipt() {
		this.xmlSchema = {
			'@': rootAttributes,

			header: {
				'@': { authenticate: true },
				static: {
					HostID: hostId,
					TransactionID: transactionId,
				},
				mutable: {
					TransactionPhase: 'Receipt',
				},
			},

			AuthSignature: authSignature,

			body: {
				TransferReceipt: {
					'@': { authenticate: true },
					ReceiptCode: 0,
				},
			},
		};

		return this;
	},

	transfer(encryptedOrderData) {
		this.xmlSchema = {
			'@': rootAttributes,

			header: {
				'@': { authenticate: true },
				static: {
					HostID: hostId,
					TransactionID: transactionId,
				},
				mutable: {
					TransactionPhase: 'Transfer',
					SegmentNumber: {
						'@': { lastSegment: true },
						'#': 1,
					},
				},
			},

			AuthSignature: authSignature,

			body: {
				DataTransfer: {
					OrderData: encryptedOrderData,
				},
			},
		};

		return this;
	},
});
