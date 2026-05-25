import net from 'net';

/**
 * Find a free TCP port by creating a temporary server on port 0,
 * reading the assigned port, then closing the server.
 *
 * This is used by tests that need to avoid port conflicts when
 * multiple test files may start servers simultaneously.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}
