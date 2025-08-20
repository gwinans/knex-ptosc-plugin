export function isDebugEnabled() {
  const env = process.env.DEBUG || '';
  return env.split(/[\s,]+/).includes('knex-ptosc-plugin');
}
