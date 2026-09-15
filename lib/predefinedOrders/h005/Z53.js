'use strict';

const utils = require('../../utils');

// EBICS 3.0 replaces H004's per-order-type codes (STA/C53/Z53/...) with a
// single generic BTD (download) order, parameterized by a BTF "Service"
// block (ServiceName/Scope/Container/MsgName) instead of OrderType. That
// BTF catalog is published separately by each country's own banking
// community, not fixed by the base EBICS 3.0 standard - see "How BTF
// differs by country" in docs/EBICS-3.0-H005.md for a Switzerland/Germany/
// France comparison. So every field of the Service block below is
// overridable, not just Scope: this helper defaults to the Swiss
// end-of-period camt.053 combination (ServiceName=EOP, Scope=CH,
// MsgName=camt.053 v08, ZIP container - from SIX Group's "EBICS 3.0
// BTF-Codes CH" catalog and the Swiss Market Practice Guidelines for
// EBICS 3.0), since that's what this library has been built and tested
// against, but passing a different `serviceName`/`scope`/`msgName`/
// `msgVersion`/`container` targets a different market or message type
// entirely (e.g. Germany's own EOP/DE/camt.053/ZIP row, or a Swiss STM/
// camt.052 intraday statement instead of an EOP/camt.053 end-of-period
// one) without touching this file. `container: false` omits the Container
// element altogether, for a market/message combination that doesn't use
// one (Container is optional per the schema).
//
// unzip the returned orderData with utils.unzip() when a ZIP container was
// requested, to get the file(s) inside.
//
// Kept named "Z53" for continuity with H004's Z53 (Swiss zipped camt.053),
// which this replaces for H005 users by default - see
// docs/EBICS-3.0-H005.md.
//
// Live-validated against PostFinance's EBICS 3.0 ISO test environment at
// the technical level: a BTD request built with the default BTF codes
// above (EOP/CH/camt.053 v08/ZIP) returned technicalCode 000000/EBICS_OK
// both with no date range and with an explicit one, meaning PostFinance's
// live system accepts and correctly processes a request built this way.
// Both attempts also came back with businessCode 090005/
// EBICS_NO_DOWNLOAD_DATA_AVAILABLE (identical either way, which rules out
// the date range being the cause) - the test subscriber simply has no
// statement data seeded, so the decrypt/unzip path for an *actual*
// downloaded statement is still only exercised by this library's own
// synthetic test fixture (test/spec/H005.js), not a real bank response.
// If you're targeting a different bank/market, confirm against your own
// bank's ISO test environment before relying on this in production,
// whichever BTF values you end up using.
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
