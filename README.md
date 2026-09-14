<p align="center">
	<img src="assets/logo.png" width="300px" height="auto"/>
</p>
<h1 align="center">node-ebics-client</h1>

<p align="center">
<a href="https://github.com/sequel-de/ebics-client/actions/workflows/CI.yml" title="Build Status"><img src="https://github.com/sequel-de/ebics-client/actions/workflows/CI.yml/badge.svg" alt="Build Status" /></a>
<a href="https://www.npmjs.com/package/@sequel-de/ebics-client" title="npm version">
<img alt="@sequel-de/ebics-client" src="https://img.shields.io/npm/v/%40sequel-de%2Febics-client">
</a>
<a href="LICENSE" title="MIT"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

> This is a fork of [node-ebics/node-ebics-client](https://github.com/node-ebics/node-ebics-client) (originally published as [`ebics-client`](https://www.npmjs.com/package/ebics-client)), published separately as [`@sequel-de/ebics-client`](https://www.npmjs.com/package/@sequel-de/ebics-client) to add EBICS 3.0 (H005) support. All credit for the original EBICS 2.5 (H004) implementation belongs to the upstream authors (see `contributors` in [package.json](package.json) and the project's git history).

Pure Node.js (>= 20) implementation of [EBICS](https://en.wikipedia.org/wiki/Electronic_Banking_Internet_Communication_Standard) (Electronic Banking Internet Communication). Tested on Node 20, 22 and 24.

The client is aimed to be 100% [ISO 20022](https://www.iso20022.org) compliant, and supports the complete initializations process (INI, HIA, HPB orders) and HTML letter generation, for both **EBICS 2.5 (H004)** and **EBICS 3.0 (H005)**.

## Install

```sh
npm install @sequel-de/ebics-client
```

```js
const { Client, Orders, fsKeysStorage } = require('@sequel-de/ebics-client');
```

## Usage

For examples on how to use this library, take a look at the [examples](https://github.com/sequel-de/ebics-client/tree/master/examples).

### Initialization

1. Create a configuration (see [example configs](https://github.com/sequel-de/ebics-client/tree/master/examples/config)) with the EBICS credentials you received from your bank and name it in this schema: `config.<environment>.<bank>[.<entity>].json` (the entity is optional).

    - The fields `url`, `partnerId`, `userId`, `hostId` are provided by your bank.
    - The `passphrase` is used to encrypt the keys file, which will be stored at the `storageLocation`.
    - The `bankName` and `bankShortName` are used internally for creating files and identifying the bank to you.
    - The `languageCode` is used when creating the Initialization Letter and can be either `de`, `en`, or `fr`.
    - You can chose any environment, bank and, optionally, entity name. Entities are useful if you have multiple EBICS users for the same bank account.

2. Run `node examples/initialize.js <environment> <bank> [entity]` to generate your key pair and perform the INI and HIA orders (ie. send the public keys to your bank)  
   The generated keys are stored in the file specified in your config and encrypted with the specified passphrase.
3. Run `node examples/bankLetter.js <environment> <bank> [entity]` to generate the Initialization Letter
4. Print the letter, sign it and send it to your bank. Wait for them to activate your EBICS account.
5. Download the bank keys by running `node examples/save-bank-keys.js <environment> <bank> [entity]`

If all these steps were executed successfully, you can now do all things EBICS, like fetching bank statements by running `node examples/send-sta-order.js <environment> <bank> [entity]`, or actually use this library in your custom banking applications.

### EBICS 3.0 (H005)

EBICS 3.0's key-management orders (INI, HIA, HPB) are supported alongside
H004, using X.509-certificate-wrapped keys as H005 requires. Use
`Orders.H005.INI` / `.HIA` / `.HPB` instead of the flat `Orders.*`, and see
[`examples/initialize-h005.js`](examples/initialize-h005.js) /
[`examples/save-bank-keys-h005.js`](examples/save-bank-keys-h005.js). H005
business order upload/download (BTU/BTD) is not yet implemented. Full
details, a code example, and the H004/H005 structural differences: see
[`docs/EBICS-3.0-H005.md`](docs/EBICS-3.0-H005.md).

## Testing

```sh
npm test    # runs the full suite, including schema validation against the
            # real, bundled EBICS XSDs (test/xsd) for both H004 and H005
npm run lint
```

See [`docs/EBICS-3.0-H005.md`](docs/EBICS-3.0-H005.md#testing) for what the
H005 schema validation specifically covers.

## Supported Banks

The client is currently tested and verified to work with the following banks:

-   [Credit Suisse (Schweiz) AG](https://www.credit-suisse.com/ch/en.html)
-   [Zürcher Kantonalbank](https://www.zkb.ch/en/lg/ew.html)
-   [Raiffeisen Schweiz](https://www.raiffeisen.ch/rch/de.html)
-   [BW Bank](https://www.bw-bank.de/de/home.html)
-   [Bank GPB International S.A.](https://gazprombank.lu/e-banking)
-   [Bank GPB AO](https://gazprombank.ru/)
-   [J.P. Morgan](https://www.jpmorgan.com/)
-   [PostFinance](https://www.postfinance.ch/) - EBICS 3.0 (H005) key management (INI/HIA/HPB), validated against their ISO test environment

## Inspiration

The basic concept of this library was inspired by the [EPICS](https://github.com/railslove/epics) library from the Railslove Team.

## Copyright

Copyright: Dimitar Nanov, 2019-2022.  
Licensed under the [MIT](LICENSE) license.
