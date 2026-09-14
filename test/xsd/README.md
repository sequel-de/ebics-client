# Bundled EBICS XSD schemas

These are the official EBICS protocol schema files, used by the test suite
(`test/spec/H004.js`, `test/spec/H005.js`) to validate that every generated
request is not just structurally plausible but actually schema-valid.

## H004 (`*_H004.xsd`, `ebics_signature.xsd`, `ebics_hev.xsd`)

The EBICS 2.5 (H004) schema family, as published by the EBICS Working Group.

## H005 (`*_H005.xsd`, `ebics_signature_S002.xsd`)

The EBICS 3.0 (H005) schema family, as published by the EBICS Working Group
(XMLSpy edit dates in each file's header comment range from March to October
2016/2017, matching the EBICS 3.0 Final Version). Sourced via
[temp3l/ebics-json-schema](https://github.com/temp3l/ebics-json-schema), a
mirror of the official schema archive also referenced by SIX Group's Swiss
Market Practice Guidelines for EBICS (`EBICS 3.0 schema
H005FinalVersion07-08-2017.zip`).

One correction was made to the upstream mirror: `ebics_types_H005.xsd` had a
stray `^` character injected directly after `<annotation>` on line 6 (an
artifact from whatever process produced that mirror, not present in any
schema-meaningful content) which made the file fail to compile as XML Schema.
It was removed; no other content was changed.

Both `ebics_H004.xsd` and `ebics_H005.xsd` are umbrella schemas that
`<include>` the rest of their respective family - validate against those two
root files (see `test/spec/H004.js` / `test/spec/H005.js` for the
`xmllint-wasm` invocation pattern, `schema` + `preload`).

`xmldsig-core-schema.xsd` (the W3C XML-DSIG core schema) and `ebics_hev.xsd`
(the version-agnostic HEV handshake schema) are shared between both
families.
