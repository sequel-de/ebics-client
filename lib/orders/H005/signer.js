'use strict';

const Crypto = require('../../crypto/Crypto');

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const C14n = require('xml-crypto/lib/c14n-canonicalization').C14nCanonicalization;

// The XML-DSIG signing mechanism (C14N canonicalization, RSA-SHA256,
// authenticate='true' xpointer reference) is unchanged between H004 and
// H005 - only the envelope namespace differs ('urn:org:ebics:H004' ->
// 'urn:org:ebics:H005'), which is why this otherwise mirrors
// lib/orders/H004/signer.js exactly, with that one string swapped.
const digest = (doc) => {
	const nodeDigestValue = doc.getElementsByTagName('ds:DigestValue')[0];

	const contentToDigest = xpath
		.select("//*[@authenticate='true']", doc)
		.map(x => new C14n().process(x))
		.join('');

	const fixedContent = contentToDigest.replace(
		/xmlns="urn:org:ebics:H005"/g,
		'xmlns="urn:org:ebics:H005" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
	);

	if (nodeDigestValue)
		nodeDigestValue.textContent = Crypto.digestWithHash(fixedContent)
			.toString('base64')
			.trim();

	return doc;
};

const sign = (doc, key) => {
	const nodeSignatureValue = doc.getElementsByTagName('ds:SignatureValue')[0];

	if (nodeSignatureValue) {
		const select = xpath.useNamespaces({
			ds: 'http://www.w3.org/2000/09/xmldsig#',
		});
		const contentToSign = new C14n()
			.process(select('//ds:SignedInfo', doc)[0])
			.replace(
				'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
				'xmlns="urn:org:ebics:H005" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
			);

		nodeSignatureValue.textContent = Crypto.privateSign(key, contentToSign);
	}

	return doc;
};

const toXML = doc => new XMLSerializer().serializeToString(doc);

module.exports = {
	sign(data, keyX) {
		const doc = new DOMParser().parseFromString(data, 'text/xml');

		return toXML(sign(digest(doc), keyX));
	},
};
