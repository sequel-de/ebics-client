'use strict';

// EBICS 3.0 (H005) key-management OrderDetails is UnsecuredReqOrderDetailsType,
// which restricts the abstract OrderDetailsType to a single 'AdminOrderType'
// field (a 3-char [A-Z0-9]{3} token) - there is no 'OrderAttribute' field at
// all (unlike H004's OrderType + OrderAttribute). Confirmed against the real
// ebics_keymgmt_request_H005.xsd / ebics_types_H005.xsd schema (EBICS 3.0,
// EBICS Working Group, October 2016), not just the Common Implementation Guide.
module.exports = {
	version: 'h005',
	orderDetails: { AdminOrderType: 'INI' },
	operation: 'ini',
};
