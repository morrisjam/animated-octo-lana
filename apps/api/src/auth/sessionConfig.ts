export function resolveAuthSessionSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.AUTH_SESSION_SECRET?.trim();
  if (!configured) {
    throw new Error('AUTH_SESSION_SECRET is required. Use the local API runner to generate an ephemeral development secret.');
  }
  return configured;
}

export function resolveAllowInsecureAccountHeader(env: NodeJS.ProcessEnv): boolean {
  const enabled = env.ALLOW_INSECURE_ACCOUNT_HEADER?.trim().toLowerCase() === 'true';
  if (!enabled) {
    return false;
  }

  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase() ?? '';
  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase() ?? '';
  const hostedDeployment = nodeEnvironment === 'production'
    || ['canary', 'staging', 'production', 'prod'].includes(deploymentEnvironment);
  if (hostedDeployment) {
    throw new Error('ALLOW_INSECURE_ACCOUNT_HEADER cannot be enabled in a hosted deployment.');
  }
  return true;
}
