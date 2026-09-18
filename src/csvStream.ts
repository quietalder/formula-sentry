import { StringDecoder } from 'node:string_decoder';

/**
 * Incremental CSV parser. feed() is called once per chunk; it appends to
 * whatever field/row is currently in progress and pushes finished rows onto
 * a queue. Nothing about this holds more than the current field and row in
 * memory, so the caller can hand it chunks from a multi-gigabyte file.
 */
class CsvParserState {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private sawQuote = false;
  private queue: string[][] = [];

  feed(text: string): void {
    let i = 0;
    while (i < text.length) {
      const c = text[i];

      if (this.inQuotes) {
        if (this.sawQuote) {
          this.sawQuote = false;
          if (c === '"') {
            this.field += '"';
            i++;
            continue;
          }
          // The quote we saw last iteration was the closing one, not an
          // escape. Fall out of the quoted field and reprocess c as normal.
          this.inQuotes = false;
          continue;
        }
        if (c === '"') {
          this.sawQuote = true;
          i++;
          continue;
        }
        this.field += c;
        i++;
        continue;
      }

      if (c === '"' && this.field.length === 0) {
        this.inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        this.endField();
        i++;
        continue;
      }
      if (c === '\r') {
        i++;
        continue;
      }
      if (c === '\n') {
        this.endField();
        this.endRow();
        i++;
        continue;
      }
      this.field += c;
      i++;
    }
  }

  // Called once after the last chunk, to emit whatever row was still open
  // (files rarely end with a trailing newline).
  flush(): void {
    if (this.field.length > 0 || this.row.length > 0) {
      this.endField();
      this.endRow();
    }
  }

  *drain(): Generator<string[]> {
    while (this.queue.length > 0) {
      yield this.queue.shift() as string[];
    }
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = '';
  }

  private endRow(): void {
    this.queue.push(this.row);
    this.row = [];
  }
}

export async function* parseCsvStream(
  chunks: AsyncIterable<Buffer | string>,
): AsyncGenerator<string[]> {
  const decoder = new StringDecoder('utf8');
  const parser = new CsvParserState();

  for await (const chunk of chunks) {
    // StringDecoder buffers any partial multi-byte character until the next
    // write, so a UTF-8 character split across two chunks still decodes
    // correctly instead of producing a mangled field.
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    parser.feed(text);
    yield* parser.drain();
  }

  const tail = decoder.end();
  if (tail) parser.feed(tail);
  parser.flush();
  yield* parser.drain();
}
