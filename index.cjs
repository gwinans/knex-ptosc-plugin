'use strict';

// Bridge to the ESM build; functions remain async Promises.
module.exports.alterTableWithBuilder = (...args) =>
  import('./index.js').then(m => m.alterTableWithBuilder(...args));
