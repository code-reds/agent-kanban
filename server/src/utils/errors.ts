/**
 * Extracts a safe error message from any thrown value.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Internal error';
}
