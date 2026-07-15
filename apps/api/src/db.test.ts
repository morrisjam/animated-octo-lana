import assert from 'node:assert/strict';
import test from 'node:test';

test('idle database connection errors are handled without terminating the process', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];

  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well';
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const { db } = await import('./db');
    const interruption = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    });

    assert.doesNotThrow(() => db.emit('error', interruption));
    assert.deepEqual(logged, [[
      '[database] Idle pool connection failed; future queries will reconnect.',
      {
        code: '57P01',
        message: 'terminating connection due to administrator command',
      },
    ]]);

    await db.end();
  } finally {
    console.error = originalConsoleError;
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
