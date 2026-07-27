const FLOW_STORAGE_KEY = "fidra-circle-login-flow";
const AUTH_STORAGE_KEY = "fidra-circle-challenge-auth";

let sdkInstance = null;

function readSessionValue(key) {
  try {
    const value = window.sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeSessionValue(key, value) {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

export function getSavedCircleFlow() {
  return readSessionValue(FLOW_STORAGE_KEY);
}

export function saveCircleFlow(flow) {
  writeSessionValue(FLOW_STORAGE_KEY, flow);
}

export function clearCircleFlow() {
  window.sessionStorage.removeItem(FLOW_STORAGE_KEY);
}

export function getChallengeAuthentication() {
  return readSessionValue(AUTH_STORAGE_KEY);
}

export function saveChallengeAuthentication(authentication) {
  writeSessionValue(AUTH_STORAGE_KEY, authentication);
}

export function clearChallengeAuthentication() {
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

export function loginConfigs(flow) {
  if (!flow?.deviceToken || !flow?.deviceEncryptionKey) return undefined;
  const configs = {
    deviceToken: flow.deviceToken,
    deviceEncryptionKey: flow.deviceEncryptionKey,
  };
  if (flow.otpToken) configs.otpToken = flow.otpToken;
  if (flow.googleClientId) {
    configs.google = {
      clientId: flow.googleClientId,
      redirectUri: `${window.location.origin}/vendor-onboarding`,
      selectAccountPrompt: true,
    };
  }
  return configs;
}

export async function getCircleSdk({ appId, flow, onLoginComplete }) {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  const configs = {
    appSettings: { appId },
    ...(loginConfigs(flow) ? { loginConfigs: loginConfigs(flow) } : {}),
  };
  if (!sdkInstance) sdkInstance = new W3SSdk(configs, onLoginComplete);
  else sdkInstance.updateConfigs(configs, onLoginComplete);
  return sdkInstance;
}

/**
 * Drives the Circle Web SDK challenge the user must explicitly approve (PIN/biometric/confirmation UI).
 * Resolves with the Circle-generated transaction id. Never fabricates a hash: the caller polls the
 * backend, which reads the real transaction state from Circle before showing a confirmed receipt.
 */
export function executeChallenge(sdk, challengeId, authentication) {
  if (authentication?.userToken && authentication?.encryptionKey) {
    sdk.setAuthentication({
      userToken: authentication.userToken,
      encryptionKey: authentication.encryptionKey,
    });
  }
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      const challenge = Array.isArray(result?.data?.challengeIds)
        ? { id: result.data.challengeIds[0] }
        : result?.data;
      resolve({ challengeId, transactionId: challenge?.transactionId ?? null, raw: result });
    });
  });
}
