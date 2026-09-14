'use strict';

// HPB's OrderDetails is NoPubKeyDigestsReqOrderDetailsType, which - like
// UnsecuredReqOrderDetailsType (see INI.js) - restricts OrderDetailsType to
// just { AdminOrderType }, no OrderAttribute.
module.exports = {
	version: 'h005',
	orderDetails: { AdminOrderType: 'HPB' },
	operation: 'ini',
};
