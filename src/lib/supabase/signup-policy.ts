import 'server-only';

export function isSignupEnabled(): boolean {
  return process.env.AUTH_ALLOW_SIGNUP === 'true';
}
