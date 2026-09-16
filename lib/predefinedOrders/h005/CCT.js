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
// used as the entry name inside the ZIP when `container` is explicitly set
// to `'ZIP'` (falls back to `document.xml`). `container` defaults to
// `false` (a plain, unwrapped document) - unlike Z53's BTD default, which
// is `'ZIP'`. This was briefly changed to default to `'ZIP'` after a live
// PostFinance test's end-of-day batch step rejected an unwrapped upload
// ("File is no ZIP archive"), but a live re-test showed PostFinance's own
// BTF catalog for this subscriber's MCT/CH/pain.001 upload has no
// Container variant at all: declaring `Container: ZIP` made the bank
// reject the request outright with technicalCode 091005
// (EBICS_INVALID_ORDER_TYPE) - worse than the original problem, and a
// regression against the `container: false` shape that had already been
// live-validated with a full EBICS_OK. See docs/EBICS-3.0-H005.md for
// both findings; the original "File is no ZIP archive" error's actual
// cause is still open. lib/orders/H005/serializers/upload.js does now
// genuinely ZIP-wrap the payload (utils.zip()) when `container: 'ZIP'` is
// passed explicitly, for a bank/market whose BTF catalog does support it.
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
// minimal pain.001 test payment built with these defaults returned a full
// EBICS_OK (technical and business level) - see docs/EBICS-3.0-H005.md for
// that run's caveats.
module.exports = (document, {
	scope = 'CH',
	serviceName = 'MCT',
	msgName = 'pain.001',
	msgVersion = '09',
	container = false,
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
