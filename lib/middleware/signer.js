'use strict';

const H004Signer = require('../orders/H004/signer');
const H005Signer = require('../orders/H005/signer');

module.exports = {
	version(v) {
		if (v.toUpperCase() === 'H004') return H004Signer;
		if (v.toUpperCase() === 'H005') return H005Signer;

		throw Error('Error from middleware/signer.js: Invalid version number');
	},
};
