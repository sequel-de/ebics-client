'use strict';

const AdmZip = require('adm-zip');

const prefixNumber = (n) => {
	if (n < 10)
		return `0${n}`;
	return n.toString();
};

const date = {
	getDateObject(d = Date.now()) {
		const dateObject = new Date(d);
		// eslint-disable-next-line no-restricted-globals
		if (isNaN(dateObject))
			throw new Error(`${d} is invalid date.`);
		return dateObject;
	},
	toISODate(d = Date.now(), utc = true) {
		const t = date.getDateObject(d);
		if (utc)
			return `${t.getUTCFullYear()}-${prefixNumber(t.getUTCMonth() + 1)}-${prefixNumber(t.getUTCDate())}`;
		return `${t.getFullYear()}-${prefixNumber(t.getMonth() + 1)}-${prefixNumber(t.getDate())}`;
	},
	toISOTime(d = Date.now(), utc = true) {
		const t = date.getDateObject(d);
		if (utc)
			return `${prefixNumber(t.getUTCHours())}:${prefixNumber(t.getUTCMinutes())}:${prefixNumber(t.getUTCSeconds())}`;
		return `${prefixNumber(t.getHours())}:${prefixNumber(t.getMinutes())}:${prefixNumber(t.getSeconds())}`;
	},
};

const dateRange = (start, end) => {
	if (start && end)
		return {
			DateRange: {
				Start: date.toISODate(start),
				End: date.toISODate(end),
			},
		};

	return {};
};

// EBICS 3.0's BTD download orders can be requested/delivered wrapped in a
// ZIP container (Service/Container containerType="ZIP" in the request) -
// standard Swiss market practice for camt.053/054/052 statement downloads
// (see lib/predefinedOrders/h005/Z53.js). `orderData()` on the response
// (lib/orders/H005/response.js) already decrypts and inflates the EBICS
// transport layer, handing back the raw ZIP archive bytes as-is - it has
// no notion of what's inside, since that's order-type/Container specific,
// not part of the generic EBICS transaction mechanics. Call this on that
// buffer to get the individual file(s) out.
const unzip = buffer => new AdmZip(buffer)
	.getEntries()
	.filter(entry => !entry.isDirectory)
	.map(entry => ({ name: entry.entryName, data: entry.getData() }));

module.exports = {
	dateRange,
	date,
	unzip,
};
