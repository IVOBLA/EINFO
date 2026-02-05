import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeHeaders,
  sanitizeUrl,
  sanitizeBody,
  isTextBasedContentType,
  limitLoggedBody,
} from '../utils/lagekarteLogger.mjs';

test('sanitizeHeaders redacts auth and cookies', () => {
  const out = sanitizeHeaders({
    Authorization: 'Bearer abc',
    Cookie: 'sid=123; login-token=abcd',
    'Set-Cookie': 'sid=123; Path=/; HttpOnly, login-token=abcd; Path=/',
    'X-Auth-Token': 'secrettoken',
    Accept: 'application/json',
  });

  assert.equal(out.Authorization, '***');
  assert.match(out.Cookie, /sid=\*\*\*/);
  assert.match(out['Set-Cookie'], /sid=\*\*\*/);
  assert.equal(out['X-Auth-Token'], '***');
  assert.equal(out.Accept, 'application/json');
});

test('sanitizeUrl redacts sensitive query parameters', () => {
  const out = sanitizeUrl('https://www.lagekarte.info/de/php/api.php?a=1&token=abc&sid=123&auth=zzz');
  assert.match(out, /token=\*\*\*/);
  assert.match(out, /sid=\*\*\*/);
  assert.match(out, /auth=\*\*\*/);
});

test('sanitizeBody redacts json and form credentials', () => {
  const json = sanitizeBody(JSON.stringify({ token: 'abc', user: 'admin', pw: 'secret', nested: { password: 'x' } }), 'application/json');
  assert.equal(json, '{"token":"***","user":"***","pw":"***","nested":{"password":"***"}}');

  const form = sanitizeBody('user=admin&pw=secret&x=1', 'application/x-www-form-urlencoded');
  assert.match(form, /user=\*\*\*/);
  assert.match(form, /pw=\*\*\*/);
  assert.match(form, /x=1/);
});

test('limitLoggedBody truncates oversized text', () => {
  const out = limitLoggedBody('a'.repeat(1024), 100);
  assert.equal(out.truncated, true);
  assert.equal(out.totalBytes, 1024);
  assert.equal(Buffer.byteLength(out.body, 'utf8'), 100);
});

test('isTextBasedContentType detects textual content types', () => {
  assert.equal(isTextBasedContentType('application/json'), true);
  assert.equal(isTextBasedContentType('text/html; charset=utf-8'), true);
  assert.equal(isTextBasedContentType('application/octet-stream'), false);
});
