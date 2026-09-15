'use strict';

const constants = require('../../consts');

const iniSerializer = require('./serializers/ini');
const downloadSerializer = require('./serializers/download');

module.exports = {
	use(order, client) {
		const operation = order.operation.toUpperCase();

		if (operation === constants.orderOperations.ini) return iniSerializer.use(order, client);
		if (operation === constants.orderOperations.download) return downloadSerializer.use(order, client);

		// BTU (upload) needs the S002 signature schema, not yet built.
		throw Error(`H005 (EBICS 3.0) does not yet implement the "${order.operation}" operation - "ini" (key management: INI/HIA/HPB) and "download" (BTD) are currently supported. Business order upload (BTU) is not yet implemented.`);
	},
};
