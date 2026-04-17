// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../api/_api-key.js', () => ({
  validateApiKey: vi.fn(),
}));

vi.mock('../_shared/entitlement-check', async () => {
  const actual = await vi.importActual<typeof import('../_shared/entitlement-check')>('../_shared/entitlement-check');
  return {
    ...actual,
    checkEntitlement: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../_shared/auth-session', () => ({
  resolveSessionUserId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../auth-session', () => ({
  validateBearerToken: vi.fn(),
}));

import { validateApiKey } from '../../api/_api-key.js';
import { checkEntitlement } from '../_shared/entitlement-check';
import { resolveSessionUserId } from '../_shared/auth-session';
import { validateBearerToken } from '../auth-session';
import { applyHostedGatewayAuth } from '../_shared/hosted-gateway-auth';

function makeRequest(pathname: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://worldmonitor.app${pathname}`, { headers });
}

describe('applyHostedGatewayAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockReturnValue({ valid: true, required: false });
    vi.mocked(checkEntitlement).mockResolvedValue(null);
    vi.mocked(resolveSessionUserId).mockResolvedValue(null);
    vi.mocked(validateBearerToken).mockResolvedValue({ valid: false });
  });

  test('passes through ungated public routes when api key is not required', async () => {
    const req = makeRequest('/api/market/v1/list-market-quotes', { Origin: 'https://worldmonitor.app' });
    const result = await applyHostedGatewayAuth(req, '/api/market/v1/list-market-quotes', {});

    expect(result).not.toBeInstanceOf(Response);
    expect(vi.mocked(validateApiKey)).toHaveBeenCalledWith(req, { forceKey: false });
    expect(vi.mocked(checkEntitlement)).toHaveBeenCalledWith(req, '/api/market/v1/list-market-quotes', {});
  });

  test('allows capability-gated route with valid api key', async () => {
    vi.mocked(validateApiKey).mockReturnValue({ valid: true, required: true });

    const req = makeRequest('/api/resilience/v1/get-resilience-score', {
      Origin: 'https://worldmonitor.app',
      'X-WorldMonitor-Key': 'real-key-123',
    });
    const result = await applyHostedGatewayAuth(req, '/api/resilience/v1/get-resilience-score', {});

    expect(result).not.toBeInstanceOf(Response);
    expect(vi.mocked(validateApiKey)).toHaveBeenCalledWith(req, { forceKey: true });
    expect(vi.mocked(checkEntitlement)).not.toHaveBeenCalled();
  });

  test('returns 401 for capability-gated route when api key is invalid and no bearer token is present', async () => {
    vi.mocked(validateApiKey).mockReturnValue({ valid: false, required: true, error: 'Invalid API key' });

    const req = makeRequest('/api/resilience/v1/get-resilience-score', {
      Origin: 'https://worldmonitor.app',
      'X-WorldMonitor-Key': 'bad-key',
    });
    const result = await applyHostedGatewayAuth(req, '/api/resilience/v1/get-resilience-score', {});

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  test('accepts valid pro bearer token for hosted premium route before entitlement stage', async () => {
    vi.mocked(validateApiKey).mockReturnValue({ valid: false, required: true, error: 'API key required' });
    vi.mocked(validateBearerToken).mockResolvedValue({ valid: true, role: 'pro', userId: 'user_pro' });

    const req = makeRequest('/api/resilience/v1/get-resilience-score', {
      Origin: 'https://worldmonitor.app',
      Authorization: 'Bearer test-token',
    });
    const result = await applyHostedGatewayAuth(req, '/api/resilience/v1/get-resilience-score', {});

    expect(result).not.toBeInstanceOf(Response);
    expect(vi.mocked(validateBearerToken)).toHaveBeenCalledWith('test-token');
    expect(vi.mocked(checkEntitlement)).toHaveBeenCalled();
  });
});
