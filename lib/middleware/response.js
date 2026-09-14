'use strict';

const H004Response = require('../orders/H004/response');
const H005Response = require('../orders/H005/response');

module.exports = {
	version(v) {
		if (v.toUpperCase() === 'H004') return H004Response;
		if (v.toUpperCase() === 'H005') return H005Response;

		throw Error('Error from middleware/response.js: Invalid version number');
	},
};
