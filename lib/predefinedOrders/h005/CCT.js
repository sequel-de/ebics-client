'use strict';

// BTU (business transaction upload) request for a payment file, e.g. a
// pain.001 SEPA/ISO 20022 credit transfer. Defaults are Swiss market
// practice (MCT/CH/pain.001 v09 - see docs/EBICS-3.0-H005.md); every field
// is overridable for other banks/markets/message types, the same way
// Z53's BTD counterpart is. `document` is the raw payment-file XML string
// to upload (unlike Z53, there is nothing to unzip on the way back - BTU
// has no response body beyond the EBICS acknowledgement).
//
// `fileName` is optional per the schema and omitted by default, but is also
// used as the entry name inside the ZIP when `container` is set (falls back
// to `document.xml`). `container` defaults to `'ZIP'`, matching Z53's BTD
// default: a live test against PostFinance's EOD batch processor with
// `container: false` (this library's original default) uploaded plain,
// unwrapped XML that EBICS itself accepted (EBICS_OK), but the bank's own
// end-of-day protocol log then rejected it with "File is no ZIP archive" -
// see docs/EBICS-3.0-H005.md. lib/orders/H005/serializers/upload.js does the
// actual ZIP-wrapping (utils.zip()); set `container: false` for a market/
// format that uploads a plain, unwrapped document instead.
//
// SignatureFlag is always present: per the H005 schema's own documentation
// (BTFParamsTyp/SignatureFlagType in ebics_orders_H005.xsd), its absence
// specifically means "this order carries no Electronic Signature and is
// authorised outside EBICS" - but lib/orders/H005/serializers/upload.js
// always embeds a real A006 SignatureData signature, so omitting the flag
// would misdeclare a signed order as unsigned (a bank could reject the
// payment or ignore the signature on that basis). `requestEDS: true` adds
// `requestEDS="true"` to request spooling into the EBICS distributed
// signature (EDS) queue instead of requiring the order to already be fully
// signed; "true" is the only value the schema allows for that attribute,
// so any other value (including the `false` default) just omits it.
//
// Live-validated against PostFinance's EBICS 3.0 ISO test environment: a
// minimal pain.001 test payment built with these defaults (before the
// container default changed - see above) returned a full EBICS_OK
// (technical and business level) at the EBICS request/response level - see
// docs/EBICS-3.0-H005.md for that run's caveats and the container fix.
module.exports = (document, {
	scope = 'CH',
	serviceName = 'MCT',
	msgName = 'pain.001',
	msgVersion = '09',
	container = 'ZIP',
	fileName = null,
	requestEDS = false,
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
			SignatureFlag: requestEDS === true ? { '@': { requestEDS: 'true' } } : {},
		},
	},
	operation: 'upload',
	document,
	container,
	fileName,
});
