'use strict';

const constants = require('../../consts');

const iniSerializer = require('./serializers/ini');

module.exports = {
	use(order, client) {
		const operation = order.operation.toUpperCase();

		if (operation === constants.orderOperations.ini) return iniSerializer.use(order, client);

		// Business order types (upload/download) in EBICS 3.0 use the BTF
		// (Business Transaction Format) model - AdminOrderType (BTU/BTD) plus
		// a <Service> block (ServiceName/Scope/MsgName/...) - which replaces
		// H004's OrderType/OrderAttribute entirely, not just relabels it. That
		// structure isn't confirmed here against a primary XSD/schema source
		// (see node-ebics-client-h005-scoping.md), so it is deliberately not
		// implemented rather than guessed at. Key management (INI/HIA/HPB) is
		// implemented and spec-grounded; upload/download are not yet.
		throw Error(`H005 (EBICS 3.0) does not yet implement the "${order.operation}" operation - only "ini" (key management: INI/HIA/HPB) is currently supported. Business order upload/download (BTU/BTD) needs the EBICS 3.0 schema confirmed before implementing.`);
	},
};
