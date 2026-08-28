import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps/desktop-ui/dist');
const html = await readFile(join(dist, 'index.html'), 'utf8');
assert.match(html, /<div id="root">/);
assert.match(html, /assets\/index-/);

const assets = join(dist, 'assets');
const files = (await readdir(assets)).filter((name) => name.endsWith('.js'));
const blobs = await Promise.all(files.map((name) => readFile(join(assets, name), 'utf8')));
const hasClerkKey = blobs.some((source) => /pk_(live|test)_[A-Za-z0-9]+/.test(source));
assert.equal(hasClerkKey, true, 'desktop-ui dist must embed a Clerk publishable key');
const hasSignInChrome = blobs.some((source) => source.includes('Continue with Google') && source.includes('Welcome to Ritual'));
assert.equal(hasSignInChrome, true, 'desktop-ui dist must include visible desktop sign-in chrome');

console.log('desktop-ui bundle check passed.');
