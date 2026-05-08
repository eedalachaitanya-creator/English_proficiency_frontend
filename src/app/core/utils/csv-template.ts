/**
 * CSV-template helpers used by the Manage Questions pages.
 *
 *   - `downloadCsvTemplate` produces a header-only template (or with one
 *     sample row) that HR can grab, fill in, and re-upload.
 *
 *   - `stripSampleRows` removes any row whose first cell starts with
 *     `SAMPLE_ROW_MARKER` from a user-supplied upload, returning a new
 *     File suitable for POST. This guarantees the canned sample row in
 *     the template never reaches the backend even if HR forgets to
 *     delete it — protecting the database from sample data.
 */

/**
 * Sentinel prefix on the first cell of any sample/template row. Visible
 * to HR (so they recognise it as a placeholder) and unmistakable enough
 * that a real authored row is unlikely to start with it by accident.
 */
export const SAMPLE_ROW_MARKER = '[SAMPLE]';

/** Result of stripping sample rows — the new upload-ready file plus how
 *  many rows were filtered out, so the caller can surface a notice. */
export interface StripSampleRowsResult {
  file: File;
  skipped: number;
}

/**
 * Generate and download a CSV template containing the header row plus,
 * optionally, a single sample data row. The sample row's first cell is
 * automatically prefixed with `SAMPLE_ROW_MARKER` so that
 * `stripSampleRows` can recognise and drop it on upload.
 */
export function downloadCsvTemplate(
  headers: string[],
  filename: string,
  sampleRow?: string[],
): void {
  const lines = [headers.map(csvEscape).join(',')];
  if (sampleRow) {
    if (sampleRow.length !== headers.length) {
      throw new Error(
        `sampleRow has ${sampleRow.length} cells but expected ${headers.length}`,
      );
    }
    const marked = sampleRow.map((value, i) =>
      i === 0 ? `${SAMPLE_ROW_MARKER} ${value}` : value,
    );
    lines.push(marked.map(csvEscape).join(','));
  }
  const csv = lines.join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', filename);
  anchor.click();

  URL.revokeObjectURL(url);
}

/**
 * Read a CSV File and drop any row whose first cell starts with
 * `SAMPLE_ROW_MARKER`. Returns a new File ready for upload, plus the
 * count of rows skipped. If no rows match, the original File is
 * returned by reference (no allocation).
 */
export async function stripSampleRows(file: File): Promise<StripSampleRowsResult> {
  const text = await readFileAsText(file);
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) {
    return { file, skipped: 0 };
  }

  const [header, ...rest] = lines;
  let skipped = 0;
  const filtered: string[] = [];
  for (const line of rest) {
    if (!line.length) {
      filtered.push(line);
      continue;
    }
    const firstCell = parseFirstCsvCell(line);
    if (firstCell.startsWith(SAMPLE_ROW_MARKER)) {
      skipped++;
      continue;
    }
    filtered.push(line);
  }

  if (skipped === 0) {
    return { file, skipped: 0 };
  }

  const newContent = [header, ...filtered].join('\n');
  return {
    file: new File([newContent], file.name, { type: file.type || 'text/csv' }),
    skipped,
  };
}

/**
 * Parse only the first field of a CSV line, handling RFC 4180 quoting
 * (a leading double-quote means the value is enclosed; embedded `""`
 * is a literal `"`). Returns the unquoted text up to but not including
 * the field-terminating comma. Sufficient for marker detection — we
 * never need the rest of the row.
 */
function parseFirstCsvCell(line: string): string {
  if (line[0] !== '"') {
    const comma = line.indexOf(',');
    return comma === -1 ? line : line.slice(0, comma);
  }
  let i = 1;
  let result = '';
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (line[i + 1] === '"') {
        result += '"';
        i += 2;
      } else {
        return result;
      }
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/** FileReader-backed Blob.text() shim. Exists because jsdom (used in
 *  unit tests) ships a Blob without a `.text()` method, and we want
 *  the production code path to be the same as the test code path. */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Quote a CSV cell per RFC 4180 if it contains a comma, double-quote,
 * or line break. Embedded double-quotes are doubled.
 */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
