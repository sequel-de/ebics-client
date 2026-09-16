'use strict';

const constants = require('../../consts');

const iniSerializer = require('./serializers/ini');
const downloadSerializer = require('./serializers/download');
const uploadSerializer = require('./serializers/upload');

module.exports = {
	use(order, client) {
		const operation = order.operation.toUpperCase();

		if (operation === constants.orderOperations.ini) return iniSerializer.use(order, client);
		if (operation === constants.orderOperations.download) return downloadSerializer.use(order, client);
		if (operation === constants.orderOperations.upload) return uploadSerializer.use(order, client);

		throw Error(`H005 (EBICS 3.0) does not support the "${order.operation}" operation - "ini" (key management: INI/HIA/HPB), "download" (BTD) and "upload" (BTU) are currently supported.`);
	},
};
