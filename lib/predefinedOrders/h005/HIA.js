'use strict';

// See INI.js for why OrderDetails is just { AdminOrderType } in H005 - same
// UnsecuredReqOrderDetailsType restriction applies to HIA.
module.exports = {
	version: 'h005',
	orderDetails: { AdminOrderType: 'HIA' },
	operation: 'ini',
};
