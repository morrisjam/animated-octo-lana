import assert from 'node:assert/strict';
import test from 'node:test';
import {
  run,
  validateResumeState,
  type DeploymentDrainGateRunOptions,
} from '../../scripts/deploymentDrainGate';

type RequestJson = NonNullable<DeploymentDrainGateRunOptions['requestJson']>;

function createEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    API_BASE_URL: 'http://127.0.0.1:8787',
    DEPLOY_EXPECT_API_HOSTNAME: '127.0.0.1',
    DEPLOY_ALLOW_INSECURE_LOCALHOST: 'true',
    API_OPS_ADMIN_KEY: 'deployment-drain-test-key',
    DEPLOY_FETCH_TIMEOUT_MS: '100',
    DEPLOY_DRAIN_TIMEOUT_SECONDS: '1',
    DEPLOY_DRAIN_POLL_INTERVAL_MS: '1000',
    ...overrides,
  };
}

function requestedDrainState(init?: RequestInit): boolean | undefined {
  if (typeof init?.body !== 'string') {
    return undefined;
  }
  return (JSON.parse(init.body) as { draining?: boolean }).draining;
}

test('failed drain requests stay fail-closed by default', async () => {
  const requestedStates: Array<boolean | undefined> = [];
  const requestJson: RequestJson = async (_url, _timeoutMs, init) => {
    requestedStates.push(requestedDrainState(init));
    throw new Error('initial drain request failed');
  };

  await assert.rejects(
    run({ env: createEnvironment(), requestJson }),
    /initial drain request failed/,
  );
  assert.deepEqual(requestedStates, [true]);
});

async function runTimedOutDrain(resumeOnFailure: boolean): Promise<Array<boolean | undefined>> {
  const requestedStates: Array<boolean | undefined> = [];
  let nowMs = 0;
  const requestJson: RequestJson = async (url, _timeoutMs, init) => {
    if (url.endsWith('/ops/matchmaking/drain')) {
      const draining = requestedDrainState(init);
      requestedStates.push(draining);
      return draining === false
        ? { status: 200, body: { draining: false, acceptingJoins: true } }
        : {
          status: 200,
          body: {
            draining: true,
            acceptingJoins: false,
            readyForProcessReplacement: false,
            queuedTickets: 1,
            activeSessions: 0,
          },
        };
    }
    assert.ok(url.endsWith('/ops/matchmaking/runtime'));
    return {
      status: 200,
      body: {
        draining: true,
        acceptingJoins: false,
        readyForProcessReplacement: false,
        queuedTickets: 1,
        activeSessions: 0,
      },
    };
  };

  await assert.rejects(
    run({
      env: createEnvironment({
        DEPLOY_RESUME_ON_DRAIN_FAILURE: resumeOnFailure ? 'true' : undefined,
      }),
      requestJson,
      now: () => nowMs,
      sleep: async (ms) => {
        nowMs += ms;
      },
    }),
    /Matchmaking drain timed out after 1s/,
  );
  return requestedStates;
}

test('drain timeout cleanup resumes only with explicit old-release opt-in', async () => {
  assert.deepEqual(await runTimedOutDrain(false), [true]);
  assert.deepEqual(await runTimedOutDrain(true), [true, false]);
});

test('resume action requires a confirmed non-draining, accepting state', async () => {
  const requestJson: RequestJson = async () => ({
    status: 200,
    body: { draining: false, acceptingJoins: false },
  });
  await assert.rejects(
    run({
      env: createEnvironment({ DEPLOY_DRAIN_ACTION: 'resume' }),
      requestJson,
    }),
    /did not confirm draining=false and acceptingJoins=true/,
  );

  assert.throws(
    () => validateResumeState({ draining: true, acceptingJoins: true }),
    /did not confirm draining=false and acceptingJoins=true/,
  );
  assert.throws(
    () => validateResumeState(null),
    /must be a JSON object/,
  );
  const resumed = { draining: false, acceptingJoins: true, activeSessions: 0 };
  assert.equal(validateResumeState(resumed), resumed);
});
