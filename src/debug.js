export function isDebugEnabled() {
  const env = process.env.DEBUG || '';
  const names = env.split(/[\s,]+/).filter(Boolean);
  return names.includes('knex-ptosc-plugin');
}
