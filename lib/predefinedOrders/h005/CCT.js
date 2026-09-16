'use strict';

// BTU (business transaction upload) request for a payment file, e.g. a
// pain.001 SEPA/ISO 20022 credit transfer. Defaults are Swiss market
// practice (MCT/CH/pain.001 v09 - see docs/EBICS-3.0-H005.md); every field
// is overridable for other banks/markets/message types, the same way
// Z53's BTD counterpart is. `document` is the raw payment-file XML string
// to upload (unlike Z53, there is nothing to unzip on the way back - BTU
// has no response body beyond the EBICS acknowledgement).
//
// `fileName` is optional per the schema and omitted by default; `container`
// is off by default (Swiss MCT/pain.001 uploads a single plain XML
// document, not a ZIP) but can be turned on for a market/format that
// zips its upload payload. `requestEDS` sets the EBICS distributed-
// signature-queue flag when explicitly passed `true` - left off by
// default, since spooling into that queue is a deliberate choice per
// upload, not something to default on.
//
// Live-validated against PostFinance's EBICS 3.0 ISO test environment: a
// minimal pain.001 test payment built with these defaults returned a full
// EBICS_OK (technical and business level) - see docs/EBICS-3.0-H005.md.
module.exports = (document, {
	scope = 'CH',
	serviceName = 'MCT',
	msgName = 'pain.001',
	msgVersion = '09',
	container = false,
	fileName = null,
	requestEDS = null,
} = {}) => ({
	version: 'h005',
	orderDetails: {
		AdminOrderType: 'BTU',
		BTUOrderParams: {
			...(fileName ? { '@': { fileName } } : {}),
			Service: {
				ServiceName: serviceName,
				Scope: scope,
				...(container ? { Container: { '@': { containerType: container } } } : {}),
				MsgName: { '@': { version: msgVersion }, '#': msgName },
			},
			...(requestEDS !== null ? { SignatureFlag: { '@': { requestEDS: String(requestEDS) } } } : {}),
		},
	},
	operation: 'upload',
	document,
});
