# EBICS 3.0 (H005) support

This library supports EBICS 3.0's key-management order types - **INI**,
**HIA** and **HPB** - plus **BTD** business-order statement download and
**BTU** business-order upload, on top of the existing EBICS 2.5 (H004)
support. This document covers what's supported, what isn't yet, how H005
differs from H004 under the hood, and how to test it.

## What's supported

- **INI** - registers your Electronic Signature (ES) public key certificate
  (A006) with the bank.
- **HIA** - registers your authentication (X002) and encryption (E002)
  public key certificates with the bank.
- **HPB** - fetches the bank's own authentication/encryption public key
  certificates.
- **BTD** (business transaction download) - `Orders.H005.Z53` downloads
  camt.053 end-of-period account statements, EBICS 3.0's replacement for
  H004's `STA`/`C53`/`Z53` orders. See
  [Business order download (BTD)](#business-order-download-btd) below.
- **BTU** (business transaction upload) - `Orders.H005.CCT` uploads payment
  files (e.g. pain.001 credit transfers), EBICS 3.0's replacement for
  H004's `CCT`/`CCS`/etc. orders. See
  [Business order upload (BTU)](#business-order-upload-btu) below.

Key generation, signing, and the bank-key digest computation are all
H005-aware (see [Key differences from H004](#key-differences-from-h004)
below).

INI/HIA/HPB/BTD/BTU have all been validated both against the real EBICS 3.0
schema (see [Testing](#testing)) and live against
[PostFinance](https://www.postfinance.ch)'s EBICS 3.0 ISO test environment.
INI/HIA/HPB all returned `EBICS_OK`, including parsing the bank's real
certificate-bearing HPB response. **BTD returned `EBICS_OK` at the
technical level too, but its data round-trip is still unverified** - see
the caveat below. **BTU (with its default `container: false` shape)
returned full `EBICS_OK` at both the technical and business level** -
PostFinance's test environment fully accepted a real (if trivial) test
payment - though a later downstream end-of-day batch step reported an
unrelated-looking error, and a `container: 'ZIP'` default was tried and
found to make things worse (a hard rejection), not better. See
[Business order upload (BTU)](#business-order-upload-btu) for the full
history.

> While building BTU, `BankPubKeyDigests` (used by both BTD and BTU) was
> found to be computed with H004's modulus/exponent digest instead of
> H005's required certificate-DER digest - a real bug in the BTD code
> published in v5.2.0. It's fixed as of this version; if you're on an
> earlier H005 release, upgrade before relying on BTD/BTU in production.

## Business order download (BTD)

EBICS 3.0 replaces H004's per-order-type upload/download orders with two
generic orders, **BTU** (upload) and **BTD** (download), parameterized by a
"BTF" (Business Transaction Format) `Service` block - `ServiceName`,
`Scope`, optionally `Container`/`ServiceOption`, and `MsgName` - instead of
a 3-letter `OrderType`. `Orders.H005.Z53` builds a BTD request for camt.053
statements using the Swiss market-practice values:

| Parameter | Value |
|---|---|
| `ServiceName` | `EOP` |
| `Scope` | `CH` |
| `MsgName` | `camt.053`, version `08` |
| `Container` | `ZIP` |

These come from SIX Group's published **["EBICS 3.0 BTF-Codes
CH"](https://www.six-group.com/dam/download/banking-services/interbank-clearing/en/standardization/ebics/ebics-btf.pdf)**
catalog and the **[Swiss Market Practice Guidelines for EBICS
3.0](https://www.six-group.com/dam/download/banking-services/standardization/ebics/market-practice-guidelines-ebics3.0-v1.3-en.pdf)**
- the same national interbank-clearing standard PostFinance and every other
Swiss EBICS bank implements - and have been **live-validated against
PostFinance's EBICS 3.0 ISO test environment**: a BTD request built with
these exact parameters returned `technicalCode: 000000`/`EBICS_OK` both
with no date range and again with an explicit `2024-01-01`-`2026-09-15`
window, meaning PostFinance's live system accepts and correctly processes
the request as built.

Both attempts also came back with `businessCode: 090005`/
`EBICS_NO_DOWNLOAD_DATA_AVAILABLE` - no statement data exists for this test
subscriber (the identical result with and without a date range rules out
the window being the cause). So while the request shape itself is proven
against a real bank, the decrypt/unzip path for an *actual* downloaded
statement is still only exercised by this library's own synthetic test
fixture (see [Testing](#testing)), not real bank-encrypted data. If your
bank's test environment has statement data seeded, confirming that
round-trip too is worthwhile before relying on this in production.

Statement downloads are delivered ZIP-wrapped per Swiss market practice
(mandatory for camt.053/054/052 in CH/LI, not optional); `orderData()`
hands back the raw ZIP bytes as-is (the generic transaction/decryption
layer has no notion of what's inside), so unzip it with `utils.unzip()`:

```js
const { Orders, utils } = require('@sequel-de/ebics-client');

const resp = await client.send(Orders.H005.Z53('2024-01-01', '2024-01-31'));
const files = utils.unzip(resp.orderData); // [{ name, data: Buffer }, ...]
```

Every field of the `Service` block is overridable -
`Orders.H005.Z53(start, end, { scope, serviceName, msgName, msgVersion,
container })` - not just `scope`/`msgVersion`, since the BTF catalog as a
whole is market-specific (see [how this differs from other EBICS
countries](#how-btf-differs-by-country) below), not just its `Scope` field.
For example:

```js
// Germany's own BTF row for statement download (EOP/DE/camt.053/ZIP - the
// ServiceName/Container happen to also match Switzerland's; Scope doesn't):
Orders.H005.Z53(start, end, { scope: 'DE' });

// A different Swiss BTF row entirely - STM/CH/camt.052 (intraday statement)
// instead of the default EOP/CH/camt.053 (end-of-period):
Orders.H005.Z53(start, end, { serviceName: 'STM', msgName: 'camt.052' });

// A market/message combination that doesn't use a ZIP container:
Orders.H005.Z53(start, end, { container: false });
```

### How BTF differs by country

The BTU/BTD/`Service` structure itself is one protocol, standardized
centrally by the EBICS working group. What differs by country is the
*catalog* of accepted `ServiceName`/`Scope`/`MsgName` combinations, each
published separately by that country's own banking community:

| | Switzerland (SIX) | Germany (DK) | France (CFONB) |
|---|---|---|---|
| Domestic scope | `CH` | `DE` | `FR` (+ `GLB` for pure ISO 20022) |
| Statement download | `EOP`/`CH`/`camt.053` v08 | `EOP`/`DE`/`camt.053` | `EOP`/`GLB`/`camt.053`, or legacy `cfonb120` under `FR` |
| Payment upload | `MCT`/`CH`/`pain.001` v09 | `SCT`/`DE`/`pain.001` (+ `SCI` for instant) | ISO `pain.001`/`GLB`, or legacy `cfonb320` under `FR` |

`ServiceName` for statement download happens to line up between CH and DE;
it does not for payment upload, and France layers its own legacy CFONB
message formats into the BTF framework alongside ISO 20022. This is why
every field of `Z53`'s BTF `Service` block is overridable rather than only
`Scope` - extending this to another market means supplying that market's
own catalog values (`serviceName`/`msgName`/`container` included), not
assuming Switzerland's `ServiceName`/`Container` will happen to match the
way Germany's does.

## Business order upload (BTU)

BTU is the write side of the BTF model described above - the same
`Service`/BTF parameterization as BTD, plus an optional `fileName`
attribute and a `SignatureFlag` element (EBICS distributed-signature
queuing - see the caveat below on why it's always present, not optional).
`Orders.H005.CCT` builds a BTU request for a pain.001 credit transfer
using Swiss market-practice values:

| Parameter | Value |
|---|---|
| `ServiceName` | `MCT` |
| `Scope` | `CH` |
| `MsgName` | `pain.001`, version `09` |
| `Container` | not set (plain, unwrapped upload) |

As with `Z53`, every field is overridable -
`Orders.H005.CCT(document, { scope, serviceName, msgName, msgVersion,
container, fileName, requestEDS })` - for other banks, markets or message
types (see [how BTF differs by country](#how-btf-differs-by-country)
above). `document` is the raw payment-file XML string to upload. Pass
`container: 'ZIP'` for a bank/market whose BTF catalog expects a
ZIP-wrapped upload - `lib/orders/H005/serializers/upload.js` then wraps
`document` into a single-entry ZIP archive before encrypting it (the entry
is named after `fileName`, or `document.xml` if none is given) - but see
the container caveat below before turning it on for a new bank without
confirming it first, since defaulting to it broke live uploads once
already:

```js
const fs = require('fs');
const { Orders } = require('@sequel-de/ebics-client');

const document = fs.readFileSync('payment.xml', 'utf8');
const [transactionId, orderId] = await client.send(Orders.H005.CCT(document));

// Germany's SCT row instead of Switzerland's MCT:
Orders.H005.CCT(document, { serviceName: 'SCT', scope: 'DE' });

// Queue into the EBICS distributed-signature (EDS) queue instead of signing outright:
Orders.H005.CCT(document, { requestEDS: true });
```

Signing reuses H004's upload logic almost unchanged - the S002 signature
payload (`OrderSignatureDataType`: `SignatureVersion`/`SignatureValue`/
`PartnerID`/`UserID`) is byte-for-byte identical to H004's S001, only the
XML namespace differs. The one real (not just namespace-deep) difference
is H005's `DataTransferRequestType`, which requires a `DataDigest` element
- the plain, unsigned SHA-256 digest of the order data - alongside
`SignatureData` in the transfer phase; H004 has no such element.
`lib/orders/H005/serializers/upload.js` computes this digest once and
reuses it both for `DataDigest` and for the RSA-PSS-signed
`SignatureValue`.

**`SignatureFlag` is always present, not just an optional extra.** Per the
H005 schema's own documentation (`BTFParamsTyp`/`SignatureFlagType` in
`test/xsd/ebics_orders_H005.xsd`), a *missing* `SignatureFlag` specifically
declares that the order carries no Electronic Signature at all and is
authorised outside EBICS - but this library's upload path always embeds a
real A006 `SignatureData` signature, so omitting the flag would misdeclare
a signed order as unsigned (a bank could reject the payment, or accept it
without validating the embedded signature). An earlier version of
`Orders.H005.CCT` omitted `SignatureFlag` by default, caught by [Cursor
Bugbot](https://cursor.com/bugbot) on the PR; it's fixed as of this
version. `requestEDS: true` now adds `requestEDS="true"` to request
spooling into the EBICS distributed signature (EDS) queue instead; any
other value (including the `false` default) leaves `SignatureFlag` present
but empty, since `"true"` is the only value the schema allows for that
attribute.

**Live-validated against PostFinance's EBICS 3.0 ISO test environment**: a
BTU request built with `Orders.H005.CCT` - a minimal pain.001.001.09 credit
transfer (`EUR 0.01`, ISO 20022's standard example creditor IBAN/BIC pair)
- returned `technicalCode: 000000`/`EBICS_OK` **and**
`businessCode: 000000`/`EBICS_OK` on both the Initialisation and Transfer
phase, with a real `OrderID` assigned. Unlike BTD (technically accepted but
business-rejected for lack of seeded test data), PostFinance fully accepted
this payment end-to-end - the strongest validation result of any H005
order type covered so far.

Caveat: that run predates the `SignatureFlag` fix described above, so it
actually submitted a request that *omitted* `SignatureFlag` while still
embedding a real ES - meaning PostFinance's test environment accepted it
either way, but the run doesn't confirm the corrected (spec-correct)
shape specifically. Worth re-running once you're testing against your own
bank, since a stricter bank could plausibly behave differently for the
two shapes even where PostFinance didn't.

**Second caveat, on `container` and a real bug that's now fixed - but the
default stays `false`.** That same original run used `container: false` -
a plain, unwrapped XML upload - and PostFinance's EBICS layer returned
`EBICS_OK` for it. But when that payment (as part of a 9-file batch) was
later run through PostFinance's test portal's "Simulate end of day"
processing, the resulting protocol log reported a real business-level
error:

```
Result: Invalid file format
Errors occurred while processing the ZIP archive
Error message: File is no ZIP archive.
```

That looked like evidence that PostFinance expected a ZIP-wrapped upload,
and it exposed a genuine bug worth fixing regardless: even when
`container: 'ZIP'` was passed explicitly, `upload.js` never actually
zipped the payload - it only added the `Container` BTF metadata to the
request, so the flag was a no-op declaration. That part is fixed:
`upload.js` now genuinely ZIP-wraps `document` via `utils.zip()` (see
`utils.js`) before digesting/encrypting it, for both `DataDigest` and the
encrypted `OrderData`, whenever `container: 'ZIP'` is passed.

Changing `Orders.H005.CCT`'s *default* to `'ZIP'` on the strength of that
evidence, however, was wrong, and got caught on a live re-test: submitting
the same 9-file batch with `container: 'ZIP'` as the default made
PostFinance reject every single upload outright, at the technical level,
with `technicalCode: 091005` / `EBICS_INVALID_ORDER_TYPE` ("order type is
unknown or not approved for use with EBICS") - worse than the original
problem, and a regression against the `container: false` shape that had
already been live-validated end-to-end. The most likely explanation: this
subscriber's actual approved BTF catalog entry for `MCT`/`CH`/`pain.001`
uploads has no `Container` variant at all, so declaring one doesn't just
get ignored - it makes the whole request match no admissible order type.
So the default is back to `false`, matching the one shape that's actually
been live-validated working end-to-end; `container: 'ZIP'` remains
available (and now actually functional) for a bank/market whose BTF
catalog does support it.

The original "File is no ZIP archive" protocol error's real cause is
still open - it's evidently not "BTU uploads need to default to
ZIP-wrapped for this subscriber", since that made things worse, not
better. If you're testing against PostFinance (or another EBICS 3.0 bank)
and get further signal on what that error actually referred to, it'd be
worth revisiting this.

Note when reproducing this: `client.upload()` (and therefore
`client.send()` for a BTU order) only returns `[transactionId, orderId]`,
unlike `download()`'s richer return value - it doesn't surface the
technical/business codes from either phase. To see them, call
`client.ebicsRequest(order)` directly for both the Initialisation and
Transfer phase (setting `order.transactionId` from the first response
before the second call), the same way `upload()` does internally.

## What's not supported (yet)

**Bank letter generation** (`examples/bankLetter.js`, `lib/BankLetter.js`)
has not been updated for H005: it prints the H004-style fingerprint (a hash
of the raw RSA modulus/exponent), not H005's certificate digest (see
below), so the printed hash won't match what an H005 bank expects if it
asks for one. Many EBICS 3.0 banks (PostFinance included) activate
subscribers through an online banking portal instead of a paper letter, so
check with your bank which flow it wants before relying on this.

## Usage

Mirrors the H004 flow (see the main [README](../README.md#initialization)),
using `Orders.H005.*` instead of the flat `Orders.*`:

```js
const { Client, Orders, fsKeysStorage } = require('ebics-client');

const client = new Client({
    url: 'https://your-bank.example/ebicsweb',
    hostId: 'YOURHOST',
    partnerId: 'YOURPARTNERID',
    userId: 'YOURUSERID',
    passphrase: 'change-me',
    keyStorage: fsKeysStorage('./keys.key'),
});

// Generates an A006/X002/E002 key pair (each wrapped in a self-signed
// certificate) if none exist yet, and registers them with the bank.
await client.send(Orders.H005.INI);
await client.send(Orders.H005.HIA);

// Once the bank has activated your subscriber:
const hpbResp = await client.send(Orders.H005.HPB);
await client.setBankKeys(hpbResp.bankKeys);
```

Runnable versions of the above: `examples/initialize-h005.js` (INI + HIA)
and `examples/save-bank-keys-h005.js` (HPB), using the same
`examples/config` / `loadConfig.js` convention as the H004 examples.

## Key differences from H004

| | H004 | H005 |
|---|---|---|
| Envelope namespace | `urn:org:ebics:H004` | `urn:org:ebics:H005` |
| Signature schema namespace | `http://www.ebics.org/S001` | `http://www.ebics.org/S002` |
| Public key representation | `ds:RSAKeyValue` (raw modulus/exponent), optionally alongside `ds:X509Data` | A self-signed X.509 certificate, carried as `ds:X509Data`/`ds:X509Certificate` **directly** under `*PubKeyInfo` - no `PubKeyValue` wrapper, no raw `RSAKeyValue` |
| `OrderDetails` (INI/HIA/HPB) | `{ OrderType, OrderAttribute }` (e.g. `OrderType: 'INI'`, `OrderAttribute: 'DZNNN'`) | `{ AdminOrderType }` only - no `OrderAttribute` field exists in H005's key-management `OrderDetails` at all |
| Bank-key digest | SHA-256 over the raw modulus + exponent | SHA-256 over the certificate's raw DER bytes, base64-encoded |

The `OrderDetails`/`AdminOrderType` difference in particular is easy to get
wrong by analogy with H004 (both "look like" a 3-letter order-type field at
a glance) - `lib/predefinedOrders/h005/{INI,HIA,HPB}.js` and the dispatch in
`lib/orders/H005/serializers/ini.js` are the places to look if you're
extending this to another H005 order type.

## Testing

```sh
npm test    # runs both H004 and H005 suites, including live XSD schema validation
npm run lint
```

`test/spec/H005.js` validates every generated INI/HIA/HPB/BTD/BTU request -
and a simulated bank HPB response - against the real, bundled EBICS 3.0
schema (`test/xsd/ebics_H005.xsd` and its includes; see
`test/xsd/README.md` for where these came from) using `xmllint-wasm`, the
same way `test/spec/H004.js` validates against `ebics_H004.xsd`. A request
that is schema-invalid fails the test, not just "looks structurally
plausible". It also round-trips a simulated BTD response
(encrypted/deflated/ZIP-wrapped, the same shape a real bank response would
have) through `response.js` and `utils.unzip()` back to the original
statement content, and, for BTU, encrypts a document through both the
Initialisation and Transfer phases and RSA/AES-decrypts it back to the
original bytes.

Schema validity doesn't prove a real bank will accept a request (that's
what the live PostFinance validation above covers for INI/HIA/HPB, and now
BTD's and BTU's request shapes too) - but it does catch the entire class of
bug this implementation actually hit during development (an invalid
`OrderDetails` shape that no bank should ever accept, and the missing
`DataDigest` element BTU's schema validation caught during development).
BTD's `Service`/BTF values are sourced from published market practice and
have been live-validated against PostFinance at the technical (`EBICS_OK`)
level, but the decrypt/unzip path for actual returned statement data has
only been exercised against this library's own synthetic fixture - see
the caveat in [Business order download (BTD)](#business-order-download-btd)
above. BTU (with its default, unwrapped `container: false` shape) returned
a full `EBICS_OK` at both the technical and business level; a later
downstream end-of-day batch step surfaced an unrelated-looking error, and
trying a ZIP-wrapped default in response made things worse (a hard
rejection) rather than better, so the default stays `container: false` -
`upload.js` now genuinely implements the ZIP-wrapping for `container:
'ZIP'`, it's just not the default. See both caveats under
[Business order upload (BTU)](#business-order-upload-btu).
