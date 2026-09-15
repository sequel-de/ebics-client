'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');
const AdmZip = require('adm-zip');

const utils = require('../../lib/utils');

describe('utils', () => {
	describe('unzip', () => {
		it('extracts file entries (name + data) from a ZIP archive buffer', () => {
			const zip = new AdmZip();
			zip.addFile('camt.053.xml', Buffer.from('<Document>statement</Document>'));
			zip.addFile('camt.054.xml', Buffer.from('<Document>notification</Document>'));

			const entries = utils.unzip(zip.toBuffer());

			assert.lengthOf(entries, 2);
			assert.sameMembers(entries.map(e => e.name), ['camt.053.xml', 'camt.054.xml']);
			const statement = entries.find(e => e.name === 'camt.053.xml');
			assert.strictEqual(statement.data.toString(), '<Document>statement</Document>');
		});

		it('skips directory entries', () => {
			const zip = new AdmZip();
			zip.addFile('files/camt.053.xml', Buffer.from('<Document/>'));

			const entries = utils.unzip(zip.toBuffer());

			assert.lengthOf(entries, 1);
			assert.strictEqual(entries[0].name, 'files/camt.053.xml');
		});
	});

	describe('dateRange', () => {
		describe('dateRange', () => {
			it('should generate empty object with partial parameters', () => {
				assert.isEmpty(utils.dateRange());
			});
			it('should throw with invalid date', () => {
				assert.throws(() => utils.dateRange('2018-15-15', '2018-20-20'));
			});
			it('should work for valid string input', () => {
				assert.containsAllDeepKeys(utils.dateRange('2018-01-15', '2018-01-20'), { DateRange: { Start: '2018-01-15', End: '2018-01-20' } });
			});
			it('should work for Date string input', () => {
				assert.containsAllDeepKeys(utils.dateRange(new Date('2018-01-15'), new Date('2018-01-20')), { DateRange: { Start: '2018-01-15', End: '2018-01-20' } });
			});
			it('should work for timestamp string input', () => {
				assert.containsAllDeepKeys(utils.dateRange(new Date('2018-01-15').getTime(), new Date('2018-01-20').getTime()), { DateRange: { Start: '2018-01-15', End: '2018-01-20' } });
			});
		});
	});
});
