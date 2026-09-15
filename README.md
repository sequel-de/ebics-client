<p align="center">
	<img src="assets/logo.png" width="300px" height="auto"/>
</p>
<h1 align="center">node-ebics-client</h1>

<p align="center">
<a href="https://github.com/sequel-de/ebics-client/actions/workflows/CI.yml" title="Build Status"><img src="https://github.com/sequel-de/ebics-client/actions/workflows/CI.yml/badge.svg" alt="Build Status" /></a>
<a href="https://github.com/sequel-de/ebics-client/pkgs/npm/ebics-client" title="GitHub Packages"><img alt="GitHub Packages" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsequel-de%2Febics-client%2Fmain%2Fpackage.json&query=%24.version&label=GitHub%20Packages&color=blue"></a>
<a href="LICENSE" title="MIT"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

> This is a fork of [node-ebics/node-ebics-client](https://github.com/node-ebics/node-ebics-client) (originally published as [`ebics-client`](https://www.npmjs.com/package/ebics-client) on the public npm registry), published separately as [`@sequel-de/ebics-client`](https://github.com/sequel-de/ebics-client/pkgs/npm/ebics-client) on **GitHub Packages** (not the public npm registry) to add EBICS 3.0 (H005) support. All credit for the original EBICS 2.5 (H004) implementation belongs to the upstream authors (see `contributors` in [package.json](package.json) and the project's git history).

Pure Node.js (>= 20) implementation of [EBICS](https://en.wikipedia.org/wiki/Electronic_Banking_Internet_Communication_Standard) (Electronic Banking Internet Communication). Tested on Node 20, 22 and 24.

The client is aimed to be 100% [ISO 20022](https://www.iso20022.org) compliant, and supports the complete initializations process (INI, HIA, HPB orders) and HTML letter generation, for both **EBICS 2.5 (H004)** and **EBICS 3.0 (H005)**.

## Install

This package is published to **[GitHub Packages](https://github.com/sequel-de/ebics-client/pkgs/npm/ebics-client)**, not the public npm registry. GitHub Packages requires authentication to install even public packages - a plain `npm install` without the setup below will fail with a 404/401.

1. Create a GitHub [personal access token](https://github.com/settings/tokens) with the `read:packages` scope.
2. Add these two lines to your project's `.npmrc` (or `~/.npmrc` for a global setting):

   ```ini
   @sequel-de:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

   (Use an environment variable rather than a literal token if this file is committed: `_authToken=${GITHUB_TOKEN}`.)

3. Install as usual:

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
H004, using X.509-certificate-wrapped keys as H005 requires, plus BTD
statement download (`Orders.H005.Z53`, camt.053). Use `Orders.H005.INI` /
`.HIA` / `.HPB` / `.Z53` instead of the flat `Orders.*`, and see
[`examples/initialize-h005.js`](examples/initialize-h005.js) /
[`examples/save-bank-keys-h005.js`](examples/save-bank-keys-h005.js) /
[`examples/download-statement-h005.js`](examples/download-statement-h005.js).
BTD's BTF parameters (`ServiceName`/`Scope`/`MsgName`/`Container`) default
to published Swiss market practice but are fully overridable for other
banks/markets/message types, and (like INI/HIA/HPB) have been live-tested
against PostFinance's ISO test environment - it returned `EBICS_OK`, though
the actual data round-trip is still unverified since that test subscriber
has no statement data seeded (see
[`docs/EBICS-3.0-H005.md`](docs/EBICS-3.0-H005.md) for the caveat); business
order upload (BTU) is not yet implemented. Full details, a code example
(including overriding the BTF defaults, and how they differ by country),
and the H004/H005 structural differences: see
[`docs/EBICS-3.0-H005.md`](docs/EBICS-3.0-H005.md).

## Testing

```sh
npm test    # runs the full suite, including schema validation against the
            # real, bundled EBICS XSDs (test/xsd) for both H004 and H005
npm run lint
```

See [`docs/EBICS-3.0-H005.md`](docs/EBICS-3.0-H005.md#testing) for what the
H005 schema validation specifically covers.

## Releasing

CI (`.github/workflows/CI.yml`) runs the test suite and lint across Node
20/22/24 on every push and PR, then a `package` job verifies the npm
tarball actually builds (`npm pack`) and uploads it as a build artifact -
so a packaging regression shows up before you ever try to publish.

No one-time secret setup is needed: publishing goes to **GitHub Packages**
(`npm.pkg.github.com`), which authenticates with the built-in
`GITHUB_TOKEN` that every workflow run already has - there's no separate
token to create or store.

**Releases happen automatically**: every push to `main` (i.e. every merged
PR) runs `.github/workflows/bump-version.yml`, which bumps `package.json`
with a `patch` version, regenerates `CHANGELOG.md`, commits and tags it,
pushes, publishes to GitHub Packages, and creates the matching GitHub
Release - no manual step for the common case.

Every merge to `main` ships as a `patch` release automatically - there's
no way to intercept that push before it publishes. **To also mark
something as a `minor` or `major` release**, trigger the same workflow by
hand afterwards: *Actions → Bump version and publish → Run workflow*, pick
the bump type. It bumps from whatever's currently published, so this adds
an explicit `minor`/`major` bump on top of the `patch` release the merge
itself already shipped.

`.github/workflows/publish.yml` still exists separately as a manual
fallback (e.g. to retry a publish for a tag that already exists) -
triggered by publishing a GitHub Release by hand through the GitHub UI,
or via *Actions → Publish to GitHub Packages → Run workflow*. It won't
fire automatically off a release the bump workflow itself creates
(GitHub doesn't chain workflow runs off events produced by the default
`GITHUB_TOKEN`, to prevent accidental infinite loops), which is exactly
why the bump workflow publishes itself rather than relying on it.

## Supported Banks

The client is currently tested and verified to work with the following banks:

-   [Credit Suisse (Schweiz) AG](https://www.credit-suisse.com/ch/en.html)
-   [Zürcher Kantonalbank](https://www.zkb.ch/en/lg/ew.html)
-   [Raiffeisen Schweiz](https://www.raiffeisen.ch/rch/de.html)
-   [BW Bank](https://www.bw-bank.de/de/home.html)
-   [Bank GPB International S.A.](https://gazprombank.lu/e-banking)
-   [Bank GPB AO](https://gazprombank.ru/)
-   [J.P. Morgan](https://www.jpmorgan.com/)
-   [PostFinance](https://www.postfinance.ch/) - EBICS 3.0 (H005) key management (INI/HIA/HPB) and BTD statement download, validated against their ISO test environment

## Inspiration

The basic concept of this library was inspired by the [EPICS](https://github.com/railslove/epics) library from the Railslove Team.

## Copyright

Copyright: Dimitar Nanov, 2019-2022.  
Licensed under the [MIT](LICENSE) license.
