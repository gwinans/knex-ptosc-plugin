# CHANGELOG

### 2025-08-22:

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
