'use strict';

const utils = require('../../utils');

// BTD (business transaction download) request for camt.053 statements.
// Defaults are Swiss market practice (see docs/EBICS-3.0-H005.md); every
// field is overridable for other banks/markets/message types.
// `container: false` omits the Container element. Unzip orderData with
// utils.unzip() when a ZIP container is used.
//
// Live-validated (EBICS_OK) against PostFinance's ISO test environment at
// the request-shape level; the decrypt/unzip path is only proven against
// this repo's own test fixture, not a real bank response - see
// docs/EBICS-3.0-H005.md.
module.exports = (start = null, end = null, {
	scope = 'CH',
	serviceName = 'EOP',
	msgName = 'camt.053',
	msgVersion = '08',
	container = 'ZIP',
} = {}) => ({
	version: 'h005',
	orderDetails: {
		AdminOrderType: 'BTD',
		BTDOrderParams: {
			Service: {
				ServiceName: serviceName,
				Scope: scope,
				...(container ? { Container: { '@': { containerType: container } } } : {}),
				MsgName: { '@': { version: msgVersion }, '#': msgName },
			},
			...utils.dateRange(start, end),
		},
	},
	operation: 'download',
});
