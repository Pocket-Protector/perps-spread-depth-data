export type ErrorCode =
  | 'timeout'
  | 'http_error'
  | 'parse_error'
  | 'ws_error'
  | 'empty_book'
  | 'unknown';

export class FetchError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly exchange: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export function classifyError(err: unknown, exchange: string): FetchError {
  if (err instanceof FetchError) return err;

  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.includes('timeout')) {
      return new FetchError('timeout', exchange, `Request timed out: ${err.message}`);
    }
    return new FetchError('unknown', exchange, err.message);
  }

  return new FetchError('unknown', exchange, String(err));
}
