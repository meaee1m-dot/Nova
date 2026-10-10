'use strict';
/*
 * iron.js — reimplementation of the Oscar TV (com.drama.mp4) native request
 * signer (libiron_fingerprint.so :: IronFingerprint.nativeSign).
 *
 * The Oscar API rejects any request to /api/* that is not accompanied by the
 * four headers produced by the app's native library:
 *
 *   X-Iron-Sig   64-char lowercase hex signature
 *   X-Iron-Ts    unix seconds (string)
 *   X-Iron-Nonce 8-char random token
 *   X-Iron-Diag  certificate diagnostic (server does not strictly validate)
 *
 * The signature is a SHA-256 chain whose "key" is derived from the APK's
 * signing-certificate fingerprint (a value that is fixed for a given APK and
 * therefore reproducible on the server side). The message that is signed is the
 * request PATH only (query string excluded).
 *
 * Algorithm (decoded from x86_64 disassembly):
 *   S    = SHA256(apk_signing_cert_der) as lowercase hex          (64 chars)
 *   b1   = S + "|" + pkgName
 *   b2   = b1 XOR "OscarTV"        (7-byte key, cycling)
 *   b3   = reverse(b2)
 *   b4   = b3 XOR "IronGuard"      (9-byte key, cycling)
 *   h3   = SHA256(SHA256(SHA256(b4)))                              (32 bytes)
 *   msg  = path + "|" + ts + "|" + nonce
 *   A    = 0x36 * 16 , B = 0x5c * 16
 *   h4   = SHA256( (h3^A) || A || A || msg )                       (64-byte prefix)
 *   h5   = SHA256( (h3^B) || B || B || h4 )                        (96-byte block)
 *   sig  = hex(h5)
 */

const crypto = require('crypto');

// SHA-256 of the OscarTV.apk signing certificate (DER). Fixed for this APK.
const CERT_FP =
  process.env.OSCAR_CERT_FP ||
  '6e2fcda8631eb49ebcba4ca8ef4c597abe84654c7d3e8096db32bdd21ecf763f';

const PKG = process.env.OSCAR_PKG || 'com.drama.mp4';

const K1 = Buffer.from('OscarTV'); // 7-byte XOR key (table @0x14250)
const K2 = Buffer.from('IronGuard'); // 9-byte XOR key (table @0x14257)
const A = Buffer.alloc(16, 0x36); // xmm2 @0x12b10
const B = Buffer.alloc(16, 0x5c); // xmm3 @0x12b20

function xorKey(buf, key) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

// h3 is constant for a given APK + package name — precompute once.
const H3 = (function () {
  const b1 = Buffer.from(CERT_FP + '|' + PKG, 'utf8');
  const b2 = xorKey(b1, K1);
  const b3 = Buffer.from(b2).reverse();
  const b4 = xorKey(b3, K2);
  let h = sha256(b4);
  h = sha256(h);
  h = sha256(h);
  return h; // 32 bytes
})();

const H3_A = xorKey(H3.subarray(0, 16), A); // h3[0:16] ^ A
const H3_B = xorKey(H3.subarray(0, 16), B); // h3[0:16] ^ B
const H3_A2 = xorKey(H3.subarray(16, 32), A); // h3[16:32] ^ A
const H3_B2 = xorKey(H3.subarray(16, 32), B); // h3[16:32] ^ B

/**
 * Produce the signature for a request path.
 * @param {string} path  e.g. "/api/movies/show.php"  (NO query string)
 * @param {string} ts    unix seconds as string
 * @param {string} nonce 8-char random token
 * @returns {string} 64-char lowercase hex
 */
function sign(path, ts, nonce) {
  const msg = Buffer.from(path + '|' + ts + '|' + nonce, 'utf8');
  const blockA = Buffer.concat([H3_A, H3_A2, A, A]); // 64 bytes
  const h4 = sha256(Buffer.concat([blockA, msg]));
  const blockB = Buffer.concat([H3_B, H3_B2, B, B, h4]); // 96 bytes
  return sha256(blockB).toString('hex');
}

function nonce8() {
  return crypto.randomBytes(8).toString('hex').slice(0, 8);
}

/**
 * Build the four X-Iron-* headers for a request path.
 * @param {string} pathname URL path (query excluded)
 * @returns {Object} header map
 */
function ironHeaders(pathname) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = nonce8();
  return {
    'X-Iron-Sig': sign(pathname, ts, nonce),
    'X-Iron-Ts': ts,
    'X-Iron-Nonce': nonce,
    'X-Iron-Diag': 'na',
  };
}

module.exports = { sign, ironHeaders, nonce8, CERT_FP, PKG };
