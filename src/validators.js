export function validatePositiveInt(name, value) {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new TypeError(`${name} must be a positive integer, got ${value}`);
  }
}

export function validatePositiveNumber(name, value) {
  if (value !== undefined && (typeof value !== 'number' || value <= 0)) {
    throw new TypeError(`${name} must be a positive number, got ${value}`);
  }
}

export function validateNonNegativeInt(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

export function validateBoolean(name, value) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean, got ${value}`);
  }
}
