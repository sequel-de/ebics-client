'use strict';

const constants = require('../../consts');

const iniSerializer = require('./serializers/ini');
const downloadSerializer = require('./serializers/download');

module.exports = {
	use(order, client) {
		const operation = order.operation.toUpperCase();

		if (operation === constants.orderOperations.ini) return iniSerializer.use(order, client);
		if (operation === constants.orderOperations.download) return downloadSerializer.use(order, client);

		// BTU (business order upload) uses the same BTF (Business Transaction
		// Format) model as BTD (AdminOrderType plus a <Service> block), now
		// implemented for download - see lib/orders/H005/serializers/
		// download.js and lib/predefinedOrders/h005/Z53.js. Upload additionally
		// needs the S002 (not H004's S001) signature schema for its
		// OrderSignatureData, which hasn't been built yet.
		throw Error(`H005 (EBICS 3.0) does not yet implement the "${order.operation}" operation - "ini" (key management: INI/HIA/HPB) and "download" (BTD) are currently supported. Business order upload (BTU) is not yet implemented.`);
	},
};
