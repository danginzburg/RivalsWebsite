import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

const CACHE_DIR = path.join(process.cwd(), 'scripts', '.cache')

export function exportUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
}

function cachePath(spreadsheetId: string): string {
  return path.join(CACHE_DIR, `${spreadsheetId}.xlsx`)
}

export async function fetchWorkbookBytes(
  spreadsheetId: string,
  opts: { fresh?: boolean } = {}
): Promise<Buffer> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const file = cachePath(spreadsheetId)

  if (!opts.fresh && existsSync(file)) {
    return readFileSync(file)
  }

  const res = await fetch(exportUrl(spreadsheetId))
  if (!res.ok) {
    throw new Error(`Failed to download workbook ${spreadsheetId}: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, buf)
  return buf
}

export async function loadWorkbook(
  spreadsheetId: string,
  opts: { fresh?: boolean } = {}
): Promise<XLSX.WorkBook> {
  const bytes = await fetchWorkbookBytes(spreadsheetId, opts)
  return XLSX.read(bytes, { type: 'buffer', cellDates: true })
}

export function sheetRows<T = Record<string, unknown>>(
  workbook: XLSX.WorkBook,
  sheetName: string
): T[] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: null, raw: true })
}

export function sheetRowsRaw(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
}

export function sheetRowsRawFormatted(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false })
}

export function listSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames
}
