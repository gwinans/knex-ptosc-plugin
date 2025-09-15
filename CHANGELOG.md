# CHANGELOG

### 2025-09-15:

**0.2.15**

- Centralized ptosc option validation with `validatePtoscOptions` helper.
- Acquire migration lock within a transaction using `SELECT ... FOR UPDATE` to block callers without busy looping.

### 2025-09-14:

**0.2.14**

- Added tests asserting TypeError for invalid numeric options.

### 2025-09-11:

**0.2.14**

- Consolidated Knex mock builders into shared test helpers.
- Ensure resolvePtoscPath error message is single line and test no newline.
- Log and surface errors during migration lock acquisition.
- Refactored option validation into reusable helpers and added unit tests for invalid values.
- Consolidated shared pt-osc arguments to remove duplicate code.

### 2025-08-24:

**0.2.13**

- Added `test:coverage` script and coverage thresholds.
- Added tests for ptoscMinRows fast path, INSTANT fallback scenarios, and index clause passthrough.
- Added tests verifying migration lock handling and statistics aggregation for multiple ALTER clauses.
- Added tests validating error handling for raw SQL inputs and UNIQUE index passthrough.

### 2025-08-23:

**0.2.12**

- Added tests ensuring errors are thrown when required migration tables are missing.
- Added tests for caching and error handling in `resolvePtoscPath`.
- Added tests for `runPtoscProcess` progress reporting, statistics parsing, and error handling.

**0.2.11**

- Check migration and lock tables concurrently when acquiring the migration lock.
- Added Vitest tests for debug environment detection.

**0.2.10**

- Handle MySQL error 4092 from `ALGORITHM=INSTANT` by routing the query through
  `pt-online-schema-change` and add regression test.

**0.2.9**

- Fixed migration lock waiting logic and added Vitest tests for `buildPtoscArgs`
  options and `acquireMigrationLock` behavior.

### 2025-08-22:

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
