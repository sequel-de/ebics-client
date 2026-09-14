'use strict';

const Key = require('./Key');

// EBICS 3.0 (H005) certificate usage per key: A006 is the ES/signature key,
// X002 authentication, E002 encryption - see Key.js's CERTIFICATE_KEY_USAGE.
const CERTIFICATE_USAGE_BY_KEY = {
	A006: 'signature',
	X002: 'authentication',
	E002: 'encryption',
};

const keyOrNull = (key) => {
	if (key instanceof Key)
		return key;
	if (!key)
		return null;
	// pem string (legacy/H004) or {pem, cert} object (H005) - see
	// Key#toPersistable()/Key.fromPersistable().
	return Key.fromPersistable(key);
};

// A bank key arrives either as a raw {mod, exp} pair (H004) or as a
// {cert: <PEM>} object (H005, extracted from a ds:X509Certificate element).
const bankKeyOrNull = (bankKey) => {
	if (bankKey instanceof Key)
		return bankKey;
	if (!bankKey)
		return null;
	if (bankKey.cert)
		return Key.fromCertificate(bankKey.cert);

	return new Key(bankKey);
};

module.exports = class Keys {
	constructor({
		A006,
		E002,
		X002,
		bankX002,
		bankE002,
	}) {
		this.keys = {
			A006: keyOrNull(A006),
			E002: keyOrNull(E002),
			X002: keyOrNull(X002),
			bankX002: bankKeyOrNull(bankX002),
			bankE002: bankKeyOrNull(bankE002),
		};
	}

	/**
	 * @param {'h004'|'h005'} [version='h004'] - selects the key material
	 *   shape: h004 generates bare RSA key pairs, h005 additionally wraps
	 *   each in a self-signed X.509 certificate (see Key#generateWithCertificate).
	 * @param {object} [options] - forwarded to Key.generateWithCertificate()
	 *   when version is h005 (commonName, validityYears, size).
	 */
	static generate(version = 'h004', options = {}) {
		const keys = {};

		if (version.toLowerCase() === 'h005') {
			Object.entries(CERTIFICATE_USAGE_BY_KEY).forEach(([key, usage]) => {
				keys[key] = Key.generateWithCertificate(usage, options);
			});

			return new Keys(keys);
		}

		Object.keys({ A006: '', X002: '', E002: '' }).forEach((key) => {
			keys[key] = Key.generate(); // Key().generate();
		});

		return new Keys(keys);
	}

	setBankKeys(bankKeys) {
		this.keys.bankX002 = bankKeyOrNull(bankKeys.bankX002);
		this.keys.bankE002 = bankKeyOrNull(bankKeys.bankE002);
	}

	a() {
		return this.keys.A006;
	}

	e() {
		return this.keys.E002;
	}

	x() {
		return this.keys.X002;
	}

	bankX() {
		return this.keys.bankX002;
	}

	bankE() {
		return this.keys.bankE002;
	}
};
