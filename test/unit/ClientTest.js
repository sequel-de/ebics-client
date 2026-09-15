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
		// Regression test: a request-level failure (DNS, TLS, connection
		// refused, a blocking proxy, ...) has no response body, so `data` is
		// undefined in rock-req's callback. Client.js used to fall through
		// into `data.toString()` after `reject(err)` (missing a `return`),
		// throwing an unrelated, uncaught TypeError instead of actually
		// rejecting with the real error - discovered while live-testing
		// against a bank from behind a proxy that blocked the connection,
		// where this masked the real "connection blocked" error entirely.
		const keyPath = path.join(os.tmpdir(), `client-error-test-keys-${process.pid}-${Date.now()}.key`);
		let client;

		before(async () => {
			// Port 1 on loopback: nothing listens there, so the connection
			// is refused immediately (no timeout needed).
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

		// Uses INI specifically because it needs no pre-existing bank keys
		// (unlike a download/upload order) - keeping this test focused on
		// the connection-failure path itself, not order-specific setup.
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
