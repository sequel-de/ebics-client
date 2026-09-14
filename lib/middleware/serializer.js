'use strict';

const H004Serializer = require('../orders/H004/serializer');
const H005Serializer = require('../orders/H005/serializer');

module.exports = {
	use(order, client) {
		const { version } = order;

		if (version.toUpperCase() === 'H004') return H004Serializer.use(order, client);
		if (version.toUpperCase() === 'H005') return H005Serializer.use(order, client);

		throw Error('Error middleware/serializer.js: Invalid version number');
	},
};
