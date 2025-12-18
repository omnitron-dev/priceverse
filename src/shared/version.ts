/**
 * Priceverse - Application Version
 * Exports version from package.json for consistent usage across the codebase
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const APP_VERSION: string = pkg.version;
