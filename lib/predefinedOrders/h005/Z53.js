'use strict';

const utils = require('../../utils');

// EBICS 3.0 replaces H004's per-order-type codes (STA/C53/Z53/...) with a
// single generic BTD (download) order, parameterized by a BTF "Service"
// block (ServiceName/Scope/Container/MsgName) instead of OrderType. For
// Swiss end-of-period camt.053 account statements, ServiceName=EOP,
// Scope=CH, MsgName=camt.053 (version 08) is the current combination
// published in SIX Group's "EBICS 3.0 BTF-Codes CH" catalog - the same
// national interbank-clearing standard PostFinance (and every other Swiss
// EBICS bank) implements. Swiss market practice for CH/LI additionally
// requires wrapping camt.053/054/052 downloads in a ZIP container (see the
// Swiss Market Practice Guidelines for EBICS 3.0, section on Container) -
// unzip the returned orderData with utils.unzip() to get the camt.053 XML
// file(s) inside.
//
// Kept named "Z53" for continuity with H004's Z53 (Swiss zipped camt.053),
// which this replaces for H005 users - see docs/EBICS-3.0-H005.md.
//
// NOT YET VALIDATED against a real bank (unlike this library's H005
// INI/HIA/HPB, which were proven live against PostFinance) - the BTF codes
// above are sourced from SIX Group's published catalog, not a live
// PostFinance response. Confirm against PostFinance's ISO test environment
// before relying on this in production.
//
// `scope`/`msgVersion` are overridable for banks/markets that use a
// different Scope or camt.053 version than Swiss default CH/08 (e.g.
// Germany also uses ServiceName=EOP for camt.053, but under Scope=DE).
module.exports = (start = null, end = null, { scope = 'CH', msgVersion = '08' } = {}) => ({
	version: 'h005',
	orderDetails: {
		AdminOrderType: 'BTD',
		BTDOrderParams: {
			Service: {
				ServiceName: 'EOP',
				Scope: scope,
				Container: { '@': { containerType: 'ZIP' } },
				MsgName: { '@': { version: msgVersion }, '#': 'camt.053' },
			},
			...utils.dateRange(start, end),
		},
	},
	operation: 'download',
});
