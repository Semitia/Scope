import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(packageRoot, '../browser/dist');
const destination = resolve(packageRoot, 'dist/browser');

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
