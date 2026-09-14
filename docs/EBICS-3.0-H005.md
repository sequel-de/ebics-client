# EBICS 3.0 (H005) support

This library supports EBICS 3.0's key-management order types - **INI**,
**HIA** and **HPB** - on top of the existing EBICS 2.5 (H004) support. This
document covers what's supported, what isn't yet, how H005 differs from
H004 under the hood, and how to test it.

## What's supported

- **INI** - registers your Electronic Signature (ES) public key certificate
  (A006) with the bank.
- **HIA** - registers your authentication (X002) and encryption (E002)
  public key certificates with the bank.
- **HPB** - fetches the bank's own authentication/encryption public key
  certificates.

Key generation, signing, and the bank-key digest computation are all
H005-aware (see [Key differences from H004](#key-differences-from-h004)
below).

This has been validated both against the real EBICS 3.0 schema (see
[Testing](#testing)) and live against
[PostFinance](https://www.postfinance.ch)'s EBICS 3.0 ISO test environment
- INI, HIA and HPB all returned `EBICS_OK`, including parsing the bank's
real certificate-bearing HPB response.

## What's not supported (yet)

**Business order upload/download (BTU/BTD)** - EBICS 3.0's replacement for
H004's per-order-type upload/download orders (the ones behind
`send-sta-order.js`, `send-c53-order.js`, etc.) - is deliberately not
implemented. Unlike INI/HIA/HPB, its exact XML structure (the BTF - Business
Transaction Format - parameterization in particular) wasn't confirmed
against a primary source or a live bank at the time this was built, so it's
been left out rather than shipped as a guess. If you need this, the H005
key-management work in `lib/orders/H005/` is a template for how to extend
it once you can validate against a real BTU/BTD schema or bank.

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

`test/spec/H005.js` validates every generated INI/HIA/HPB request - and a
simulated bank HPB response - against the real, bundled EBICS 3.0 schema
(`test/xsd/ebics_H005.xsd` and its includes; see `test/xsd/README.md` for
where these came from) using `xmllint-wasm`, the same way
`test/spec/H004.js` validates against `ebics_H004.xsd`. A request that is
schema-invalid fails the test, not just "looks structurally plausible".

Schema validity doesn't prove a real bank will accept a request (that's
what the live PostFinance validation above covers) - but it does catch the
entire class of bug this implementation actually hit during development
(an invalid `OrderDetails` shape that no bank should ever accept).
