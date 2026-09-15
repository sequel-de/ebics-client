'use strict';

/* eslint-env node, mocha */

const path = require('path');
const os = require('os');
const fs = require('fs');

const { assert } = require('chai');

const {
	Client, Orders, fsKeysStorage, tracesStorage,
} = require('../../index.js');

describe('Client', () => {
	describe('instantiating', () => {
		it('should throw with no options provided', () => assert.throws(() => new Client()));
		it('should throw with no url provided', () => assert.throws(() => new Client({})));
		it('should throw with no partnerId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com' })));
		it('should throw with no userId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com', partnerId: 'partnerId' })));
		it('should throw with no hostId provided', () => assert.throws(() => new Client({ url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId' })));
		it('should throw with no passphrase provided', () => assert.throws(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId',
		})));
		it('should throw with no keyStorage provided', () => assert.throws(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test',
		})));
		it('should create an isntance without tracesStorage', () => assert.doesNotThrow(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test', keyStorage: fsKeysStorage('./test.key'),
		})));
		it('should create an isntance with tracesStorage', () => assert.doesNotThrow(() => new Client({
			url: 'https://myebics.com', partnerId: 'partnerId', userId: 'userId', hostId: 'hostId', passphrase: 'test', keyStorage: fsKeysStorage('./test.key'), tracesStorage: tracesStorage('./'),
		})));
	});

	describe('ebicsRequest error handling', () => {
		// Regression test for a missing `return` before reject(err) that let
		// connection failures fall through into an unrelated TypeError.
		const keyPath = path.join(os.tmpdir(), `client-error-test-keys-${process.pid}-${Date.now()}.key`);
		let client;

		before(async () => {
			// Port 1 on loopback: connection refused immediately, no listener.
			client = new Client({
				url: 'http://127.0.0.1:1/ebicsweb',
				partnerId: 'PARTNER1',
				userId: 'USER1',
				hostId: 'HOST1',
				passphrase: 'test',
				keyStorage: fsKeysStorage(keyPath),
			});
		});

		after(() => {
			if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
		});

		it('rejects with the real connection error instead of throwing an unrelated TypeError', async () => {
			try {
				await client.send(Orders.INI);
				assert.fail('expected client.send() to reject');
			} catch (e) {
				assert.notInstanceOf(e, TypeError);
				assert.notMatch(e.message, /Cannot read propert/);
			}
		});
	});
});
