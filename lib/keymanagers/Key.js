'use strict';

const forge = require('node-forge');

const {
	pki: {
		rsa,
		publicKeyToPem,
		privateKeyToPem,
		publicKeyFromPem,
		privateKeyFromPem,
		certificateToPem,
		certificateFromPem: forgeCertificateFromPem,
		createCertificate,
	},
	jsbn: {
		BigInteger,
	},
	md: {
		sha256,
	},
	util: {
		bytesToHex,
	},
} = forge;

// EBICS 3.0 self-signed certificate field requirements, per the EBICS Common
// Implementation Guide (based on EBICS 3.0), Annex 3.1 "Allocation of the
// X.509 Structure" - one KeyUsage profile per key usage (signature/ES,
// authentication, encryption). All three otherwise share the same shape:
// X.509v3, self-issued (issuer === subject), RSA-SHA256, AuthorityKeyIdentifier
// pointing at the certificate's own SubjectKeyIdentifier.
const CERTIFICATE_KEY_USAGE = {
	// A006 - the electronic signature (ES) key
	signature: { nonRepudiation: true },
	// X002 - the identification and authentication key
	authentication: { digitalSignature: true },
	// E002 - the encryption key
	encryption: { keyEncipherment: true },
};

// EBICS 3.0 allows an "unlimited" validity for customer-bank communication in
// Germany, Austria and Switzerland, expressed as notAfter = 9999-12-31T23:59:59Z
// (GeneralizedTime 99991231235959Z).
const UNLIMITED_VALIDITY = new Date(Date.UTC(9999, 11, 31, 23, 59, 59));

const getKeyType = (str) => {
	const matches = str.match(/(PRIVATE|PUBLIC) KEY/);
	if (!matches)
		return null;
	return matches[1].toLowerCase();
};

const keyFromPem = (pem) => {
	const type = getKeyType(pem);
	const isPublic = type === 'public';
	const key = isPublic ? publicKeyFromPem(pem) : privateKeyFromPem(pem);

	return {
		isPublic,
		key,
	};
};

/**
 * Creates a public key from modulus and exponent
 * @param {Buffer} mod - the modulus
 * @param {Buffer} exp - the exponent
 */
const keyFromModAndExp = (mod, exp) => {
	const bnMod = new BigInteger(mod.toString('hex'), 16);
	const bnExp = new BigInteger(exp.toString('hex'), 16);

	return {
		key: rsa.setPublicKey(bnMod, bnExp),
		isPublic: true,
	};
};

module.exports = class Key {
	constructor({
		pem = null, mod = null, exp = null, size = 2048, cert = null,
	} = {}) {
		this.certificate = cert ? forgeCertificateFromPem(cert) : null;

		// generate new private key
		if (!pem && !mod && !exp) {
			const keyPair = rsa.generateKeyPair(size);

			this.keyIsPublic = false;
			this.privateKey = keyPair.privateKey;
			this.publicKey = keyPair.publicKey;

			return;
		}

		// new key from pem string
		if (pem) {
			const { key, isPublic } = keyFromPem(pem);

			this.keyIsPublic = isPublic;
			this.privateKey = isPublic ? null : key;
			this.publicKey = isPublic ? key : null;

			return;
		}

		// new key from mod and exp
		if (mod && exp) {
			const { key, isPublic } = keyFromModAndExp(mod, exp);

			this.keyIsPublic = isPublic;
			this.privateKey = isPublic ? null : key;
			this.publicKey = isPublic ? key : null;

			return;
		}

		// not good
		throw new Error(`Can not create key without ${!mod ? 'modulus' : 'exponent'}.`);
	}

	static generate(size = 2048) {
		return new Key({ size });
	}

	static importKey({ mod, exp }) {
		return new Key({ mod, exp });
	}

	/**
	 * Generates a new RSA key pair together with a self-signed X.509
	 * certificate wrapping its public key, per the field requirements in the
	 * EBICS Common Implementation Guide (based on EBICS 3.0), Annex 3.1, for
	 * EBICS 3.0 (H005) key initialisation (INI/HIA/HPB).
	 * @param {'signature'|'authentication'|'encryption'} usage - which of the
	 *   three EBICS key usages this certificate is for; selects the KeyUsage
	 *   extension.
	 * @param {object} [options]
	 * @param {string} [options.commonName] - X.509 subject/issuer CommonName.
	 *   Defaults to a generic placeholder; callers should pass something
	 *   identifying the subscriber (e.g. partnerId/userId).
	 * @param {number|'unlimited'} [options.validityYears=5] - certificate
	 *   validity. EBICS 3.0 allows "unlimited" (notAfter 9999-12-31) for
	 *   customer-bank communication in DE/AT/CH.
	 * @param {number} [options.size=2048] - RSA key length in bits (EBICS 3.0
	 *   requires at least 2048).
	 */
	static generateWithCertificate(usage, {
		commonName = 'EBICS Subscriber', validityYears = 5, size = 2048,
	} = {}) {
		if (!Object.prototype.hasOwnProperty.call(CERTIFICATE_KEY_USAGE, usage))
			throw new Error(`Unknown certificate usage "${usage}". Expected one of: ${Object.keys(CERTIFICATE_KEY_USAGE).join(', ')}.`);

		const key = new Key({ size });

		key.generateCertificate(usage, { commonName, validityYears });

		return key;
	}

	/**
	 * Generates and attaches a self-signed X.509 certificate for this key's
	 * public key. Requires the private key (self-signing needs it).
	 * @param {'signature'|'authentication'|'encryption'} usage
	 * @param {object} [options]
	 * @param {string} [options.commonName='EBICS Subscriber']
	 * @param {number|'unlimited'} [options.validityYears=5]
	 */
	generateCertificate(usage, { commonName = 'EBICS Subscriber', validityYears = 5 } = {}) {
		if (this.keyIsPublic)
			throw new Error('Can not self-sign a certificate without the private key.');
		if (!Object.prototype.hasOwnProperty.call(CERTIFICATE_KEY_USAGE, usage))
			throw new Error(`Unknown certificate usage "${usage}". Expected one of: ${Object.keys(CERTIFICATE_KEY_USAGE).join(', ')}.`);

		const cert = createCertificate();

		cert.publicKey = this.publicKey;
		// Random serial number, max 20 bytes per the spec. DER INTEGER must be
		// non-negative, so a leading 0x00 byte is prefixed whenever the first
		// random byte would otherwise set the sign bit.
		const serialBytes = forge.random.getBytesSync(19);
		cert.serialNumber = bytesToHex(serialBytes.charCodeAt(0) & 0x80 ? `\x00${serialBytes}` : serialBytes);

		cert.validity.notBefore = new Date();
		cert.validity.notAfter = validityYears === 'unlimited'
			? UNLIMITED_VALIDITY
			: new Date(new Date().setFullYear(cert.validity.notBefore.getFullYear() + validityYears));

		const attrs = [{ name: 'commonName', value: commonName }];

		cert.setSubject(attrs);
		cert.setIssuer(attrs); // self-signed: issuer === subject

		// node-forge computes 'subjectKeyIdentifier' itself whenever a `cert` is
		// attached to the extension options (which cert.setExtensions() always
		// does) - it ignores any explicit value passed in for that extension and
		// always derives it via cert.generateSubjectKeyIdentifier(), a hash of
		// the RSAPublicKey structure. We rely on that rather than fighting it,
		// and point 'authorityKeyIdentifier' at `keyIdentifier: true`, which
		// forge resolves via that exact same method (see node_modules/node-forge
		// /lib/x509.js, the 'subjectKeyIdentifier' and 'authorityKeyIdentifier'
		// branches of the extension-fill switch) - guaranteeing AKI === SKI for
		// this self-signed certificate, per the spec table ("AuthorityKeyIdentifier
		// = SubjectKeyIdentifier of the CA or of the current certificate").
		cert.setExtensions([
			{ name: 'subjectKeyIdentifier' },
			{ name: 'authorityKeyIdentifier', keyIdentifier: true },
			{ name: 'keyUsage', ...CERTIFICATE_KEY_USAGE[usage] },
		]);

		cert.sign(this.privateKey, sha256.create());

		this.certificate = cert;

		return this;
	}

	hasCertificate() {
		return !!this.certificate;
	}

	/**
	 * @returns {string} PEM-encoded self-signed X.509 certificate for this
	 *   key's public key.
	 */
	toCertPem() {
		if (!this.certificate)
			throw new Error('This key has no certificate. Call generateCertificate() first.');

		return certificateToPem(this.certificate);
	}

	/**
	 * @returns {Buffer} DER-encoded bytes of the certificate, as embedded
	 *   (base64) in ds:X509Certificate.
	 */
	certificateDer() {
		if (!this.certificate)
			throw new Error('This key has no certificate. Call generateCertificate() first.');

		return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(this.certificate)).getBytes(), 'binary');
	}

	n(to = 'buff') {
		const key = this.keyIsPublic ? this.publicKey : this.privateKey;
		const keyN = Buffer.from(key.n.toByteArray());

		return to === 'hex' ? keyN.toString('hex', 1) : keyN;
	}

	e(to = 'buff') {
		const key = this.keyIsPublic ? this.publicKey : this.privateKey;
		const eKey = Buffer.from(key.e.toByteArray());

		return to === 'hex' ? eKey.toString('hex') : eKey;
	}

	d() {
		if (this.keyIsPublic)
			throw new Error('Can not get d component out of public key.');

		return Buffer.from(this.privateKey.d.toByteArray());
	}

	isPrivate() {
		return !this.keyIsPublic;
	}

	isPublic() {
		return this.keyIsPublic;
	}

	// eslint-disable-next-line class-methods-use-this
	size() {
		const keyN = this.n('hex');
		const bn = new BigInteger(keyN, 16);

		return bn.bitLength();
	}

	toPem() {
		return this.keyIsPublic ? publicKeyToPem(this.publicKey) : privateKeyToPem(this.privateKey);
	}
};
