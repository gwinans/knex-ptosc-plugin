'use strict';

// Bridge to the ESM build; functions remain async Promises.
module.exports.alterTableWithPtosc = (...args) =>
  import('./index.js').then(m => m.alterTableWithPtosc(...args));
