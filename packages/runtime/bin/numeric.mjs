export function requiredBigInt(value, field, allowEmptyHex = false) {
  if (value === undefined || value === null || value === '' || /^0x$/i.test(String(value).trim())) {
    if (allowEmptyHex) return 0n
    throw new Error(`Swap ${field} is missing; no transaction was submitted.`)
  }
  try {
    return BigInt(value)
  } catch {
    throw new Error(`Swap ${field} is invalid; no transaction was submitted.`)
  }
}
