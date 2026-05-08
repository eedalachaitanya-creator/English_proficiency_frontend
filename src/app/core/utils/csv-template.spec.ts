import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { downloadCsvTemplate, stripSampleRows, SAMPLE_ROW_MARKER } from './csv-template';

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('downloadCsvTemplate', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let anchorClickSpy: ReturnType<typeof vi.fn>;
  let createdAnchors: HTMLAnchorElement[];
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;
  let createElementSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    createdAnchors = [];
    anchorClickSpy = vi.fn();
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();

    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;

    const realCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
      ((tag: string) => {
        const el = realCreateElement(tag) as HTMLElement;
        if (tag.toLowerCase() === 'a') {
          (el as HTMLAnchorElement).click = anchorClickSpy as unknown as () => void;
          createdAnchors.push(el as HTMLAnchorElement);
        }
        return el;
      }) as typeof document.createElement,
    );
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    createElementSpy?.mockRestore();
  });

  it('creates a Blob containing only the header row + trailing newline', async () => {
    downloadCsvTemplate(['title', 'body', 'difficulty', 'topic'], 'reading-passages-template.csv');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const text = await readBlobAsText(blob);
    expect(text).toBe('title,body,difficulty,topic\n');
  });

  it('sets the anchor download attribute to the supplied filename', () => {
    downloadCsvTemplate(['a', 'b'], 'mcq-questions-template.csv');

    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].getAttribute('download')).toBe('mcq-questions-template.csv');
    expect(createdAnchors[0].href).toContain('blob:mock-url');
  });

  it('clicks the anchor exactly once and revokes the object URL afterwards', () => {
    downloadCsvTemplate(['x'], 'x.csv');

    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('emits headers in the order supplied (no sorting / dedup)', async () => {
    downloadCsvTemplate(
      ['question_type', 'difficulty', 'stem', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer'],
      'mcq-questions-template.csv',
    );

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const text = await readBlobAsText(blob);
    expect(text).toBe(
      'question_type,difficulty,stem,option_a,option_b,option_c,option_d,correct_answer\n',
    );
  });

  it('appends a sample row prefixed with SAMPLE_ROW_MARKER on the first cell', async () => {
    downloadCsvTemplate(
      ['title', 'body', 'difficulty', 'topic'],
      'reading-passages-template.csv',
      ['Example Title', 'Example body text', 'intermediate', 'sample-topic'],
    );

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const text = await readBlobAsText(blob);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('title,body,difficulty,topic');
    expect(lines[1].startsWith(SAMPLE_ROW_MARKER)).toBe(true);
    expect(lines[1]).toContain('Example body text');
    expect(lines[1]).toContain('intermediate');
    expect(lines[1]).toContain('sample-topic');
  });

  it('quotes sample-row cells that contain commas, quotes, or newlines', async () => {
    downloadCsvTemplate(
      ['title', 'body'],
      'p.csv',
      ['Title, with comma', 'Body with "quotes"'],
    );

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    const text = await readBlobAsText(blob);
    // First cell value must be quoted because the marker-prefixed string
    // contains a comma; second cell must be quoted because it has quotes
    // (which themselves get doubled per RFC 4180).
    expect(text).toContain(`"${SAMPLE_ROW_MARKER} Title, with comma"`);
    expect(text).toContain('"Body with ""quotes"""');
  });
});

describe('stripSampleRows', () => {
  function makeFile(content: string): File {
    return new File([content], 'upload.csv', { type: 'text/csv' });
  }

  it('drops rows whose first cell starts with SAMPLE_ROW_MARKER', async () => {
    const csv =
      'title,body,difficulty,topic\n' +
      `${SAMPLE_ROW_MARKER} Sample Title,Sample body text,intermediate,demo\n` +
      'Real Title,Real body text,expert,real-topic\n';
    const result = await stripSampleRows(makeFile(csv));

    expect(result.skipped).toBe(1);
    const text = await readBlobAsText(result.file);
    expect(text).toBe(
      'title,body,difficulty,topic\n' +
      'Real Title,Real body text,expert,real-topic\n',
    );
  });

  it('returns the original file untouched when no sample rows are present', async () => {
    const csv =
      'title,body,difficulty,topic\n' +
      'Real Title,Real body,intermediate,real-topic\n';
    const original = makeFile(csv);
    const result = await stripSampleRows(original);

    expect(result.skipped).toBe(0);
    expect(result.file).toBe(original);
  });

  it('handles a quoted first cell that contains commas after the marker', async () => {
    const csv =
      'title,body\n' +
      `"${SAMPLE_ROW_MARKER} Title, with, commas",sample body\n` +
      'Real,real body\n';
    const result = await stripSampleRows(makeFile(csv));

    expect(result.skipped).toBe(1);
    const text = await readBlobAsText(result.file);
    expect(text).toBe('title,body\nReal,real body\n');
  });

  it('preserves non-sample rows even when SAMPLE_ROW_MARKER appears in a non-first cell', async () => {
    // The marker must be on the FIRST cell to count as a sample row.
    // A row that mentions the marker text inside (e.g.) the body column
    // should NOT be dropped — that text might be legitimately authored.
    const csv =
      'title,body\n' +
      `Real Title,${SAMPLE_ROW_MARKER} this is body content\n`;
    const result = await stripSampleRows(makeFile(csv));

    expect(result.skipped).toBe(0);
  });

  it('drops multiple sample rows in a single upload', async () => {
    const csv =
      'title,body\n' +
      `${SAMPLE_ROW_MARKER} A,a-body\n` +
      `${SAMPLE_ROW_MARKER} B,b-body\n` +
      'Real,real-body\n';
    const result = await stripSampleRows(makeFile(csv));

    expect(result.skipped).toBe(2);
    const text = await readBlobAsText(result.file);
    expect(text).toBe('title,body\nReal,real-body\n');
  });
});
