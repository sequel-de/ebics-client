# EBICS 3.0 (H005) support

This library supports EBICS 3.0's key-management order types - **INI**,
**HIA** and **HPB** - plus **BTD** business-order statement download, on top
of the existing EBICS 2.5 (H004) support. This document covers what's
supported, what isn't yet, how H005 differs from H004 under the hood, and
how to test it.

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

Key generation, signing, and the bank-key digest computation are all
H005-aware (see [Key differences from H004](#key-differences-from-h004)
below).

INI/HIA/HPB/BTD have been validated both against the real EBICS 3.0 schema
(see [Testing](#testing)) and live against
[PostFinance](https://www.postfinance.ch)'s EBICS 3.0 ISO test environment.
INI/HIA/HPB all returned `EBICS_OK`, including parsing the bank's real
certificate-bearing HPB response. **BTD returned `EBICS_OK` at the
technical level too, but its data round-trip is still unverified** - see
the caveat below.

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

## What's not supported (yet)

**Business order upload (BTU)** - the write side of the BTF model above
(e.g. uploading `pain.001` payments) - is not yet implemented. Its request
shape is the mirror image of BTD (same `Service`/BTF parameterization,
plus a `fileName` attribute and optional `SignatureFlag`), but its
signature XML needs the `S002` schema (not H004's `S001`, and not quite
identical to it), which hasn't been built. `lib/orders/H005/serializers/
download.js` is the template for how BTD was added; upload would follow the
same shape with the H004 upload serializer's encryption/signing logic
adapted for `S002`.

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

`test/spec/H005.js` validates every generated INI/HIA/HPB/BTD request - and
a simulated bank HPB response - against the real, bundled EBICS 3.0 schema
(`test/xsd/ebics_H005.xsd` and its includes; see `test/xsd/README.md` for
where these came from) using `xmllint-wasm`, the same way
`test/spec/H004.js` validates against `ebics_H004.xsd`. A request that is
schema-invalid fails the test, not just "looks structurally plausible". It
also round-trips a simulated BTD response (encrypted/deflated/ZIP-wrapped,
the same shape a real bank response would have) through `response.js` and
`utils.unzip()` back to the original statement content.

Schema validity doesn't prove a real bank will accept a request (that's
what the live PostFinance validation above covers for INI/HIA/HPB, and now
BTD's request shape too) - but it does catch the entire class of bug this
implementation actually hit during development (an invalid `OrderDetails`
shape that no bank should ever accept). BTD's `Service`/BTF values are
sourced from published market practice and have been live-validated
against PostFinance at the technical (`EBICS_OK`) level, but the
decrypt/unzip path for actual returned statement data has only been
exercised against this library's own synthetic fixture - see the caveat in
[Business order download (BTD)](#business-order-download-btd) above.
