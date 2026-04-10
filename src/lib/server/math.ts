export function average(values: Array<number | null | undefined>): number | null {
  const nums = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (nums.length === 0) return null
  return nums.reduce((total, value) => total + value, 0) / nums.length
}

export function weightedAverage(
  rows: Record<string, unknown>[],
  valueKey: string,
  weightKey: string
): number | null {
  const weighted = rows
    .map((row) => ({ value: Number(row[valueKey]), weight: Number(row[weightKey]) }))
    .filter(
      (entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0
    )

  if (weighted.length === 0) return null

  const totalWeight = weighted.reduce((total, entry) => total + entry.weight, 0)
  if (totalWeight <= 0) return null

  return weighted.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>(
    (total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0),
    0
  )
}
