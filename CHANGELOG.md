# CHANGELOG

### 2025-08-23:

**0.2.13**

- Stream statistics line-by-line and invoke `onStatistics` for each update.

**0.2.12**

- Remove ineffective `maxBuffer` option from `child_process.spawn`.
- Test `ptoscMinRows` bypass and `chunkSize` forwarding in `alterTableWithPtoscRaw`.
- Extract progress line parsing helper for stdout and stderr.
- Wait for existing migration locks to clear instead of treating them as acquired.
- Validate logger methods and throw if they are not functions.

### 2025-08-22:

**0.2.11**

- Test caching of `resolvePtoscPath` to avoid redundant path lookups.

**0.2.10**

- Test option handling in `alterTableWithPtoscRaw`.

**0.2.9**

- Parse progress updates delimited by carriage returns and from stderr.

**0.2.8**

- Added `alterTableWithPtoscRaw` to run raw `ALTER TABLE` statements.

**0.2.7**

- Changed default `ptoscMinRows` to 0.
- Documented ESM `import` usage in the README.

**0.2.6:**

- Added `ptoscMinRows` option to run native `ALTER TABLE` when table rows are
  below a threshold.

**0.2.5:**

- Pass pt-osc ETA through the `onProgress` callback.

**0.2.4:**

- Catches error 4092 and forces the alter to run through
  `pt-online-schema-change`.
  - This error indicates the table has too many versions and must be rebuilt.

---

Sorry for the lack of a CHANGELOG prior to 0.2.4. Feel free to review the closed
pull reqs.

I may come back and update this later.
