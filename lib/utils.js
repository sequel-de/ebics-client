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

// Extracts the file(s) from a ZIP-wrapped BTD orderData buffer.
const unzip = buffer => new AdmZip(buffer)
	.getEntries()
	.filter(entry => !entry.isDirectory)
	.map(entry => ({ name: entry.entryName, data: entry.getData() }));

// Wraps content into a single-entry ZIP archive, for a BTU orderData that
// declares a ZIP Container. The entry's timestamp is fixed so the output is
// byte-identical across repeated calls with the same input - upload.js needs
// that determinism because it builds this buffer once for the digest (in the
// Initialisation phase) and again for the encrypted transfer (in the
// Transfer phase), and both must be the exact same bytes.
const zip = (entryName, data) => {
	const archive = new AdmZip();
	const entry = archive.addFile(entryName, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
	entry.header.time = new Date(0);
	return archive.toBuffer();
};

module.exports = {
	dateRange,
	date,
	unzip,
	zip,
};
