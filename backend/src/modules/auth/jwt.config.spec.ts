import { DEV_JWT_SECRET, jwtModuleOptions, jwtSecret } from './jwt.config';

const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setEnv(secret: string | undefined, nodeEnv: string | undefined) {
  if (secret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}

afterEach(() => {
  setEnv(ORIGINAL_SECRET, ORIGINAL_NODE_ENV);
});

const REAL_SECRET = 'a-genuinely-long-random-secret-value';

describe('jwtSecret', () => {
  it('returns the configured secret', () => {
    setEnv(REAL_SECRET, 'development');
    expect(jwtSecret()).toBe(REAL_SECRET);
  });

  it('reads the environment at CALL time, not at import time', () => {
    // The whole bug this replaces: the secret used to be captured in a module
    // decorator, which runs before ConfigModule loads .env.
    setEnv('first-secret-value-long-enough', 'development');
    expect(jwtSecret()).toBe('first-secret-value-long-enough');
    setEnv('second-secret-value-long-enough', 'development');
    expect(jwtSecret()).toBe('second-secret-value-long-enough');
  });

  it('trims surrounding whitespace from the env value', () => {
    setEnv(`  ${REAL_SECRET}  `, 'development');
    expect(jwtSecret()).toBe(REAL_SECRET);
  });

  describe('outside production', () => {
    it('falls back to the dev secret when unset, rather than failing to boot', () => {
      setEnv(undefined, 'development');
      expect(jwtSecret()).toBe(DEV_JWT_SECRET);
    });

    it('treats an empty or whitespace-only value as unset', () => {
      setEnv('   ', 'development');
      expect(jwtSecret()).toBe(DEV_JWT_SECRET);
    });

    it('allows a short secret but warns', () => {
      setEnv('tooshort', 'development');
      expect(jwtSecret()).toBe('tooshort');
    });

    it('falls back when NODE_ENV is not set at all', () => {
      setEnv(undefined, undefined);
      expect(jwtSecret()).toBe(DEV_JWT_SECRET);
    });
  });

  describe('in production', () => {
    it('refuses to start with no secret rather than using the committed fallback', () => {
      // An app that will not boot is safer than one issuing forgeable admin
      // tokens signed with a value published in this repository.
      setEnv(undefined, 'production');
      expect(() => jwtSecret()).toThrow(/JWT_SECRET is not set/);
    });

    it('refuses the dev placeholder even when explicitly configured', () => {
      setEnv(DEV_JWT_SECRET, 'production');
      expect(() => jwtSecret()).toThrow(/development placeholder/);
    });

    it('refuses a secret that is too short to resist brute force', () => {
      setEnv('short', 'production');
      expect(() => jwtSecret()).toThrow(/at least 16/);
    });

    it('accepts a proper secret', () => {
      setEnv(REAL_SECRET, 'production');
      expect(jwtSecret()).toBe(REAL_SECRET);
    });
  });
});

describe('jwtModuleOptions', () => {
  it('supplies only the secret — no dead signOptions', () => {
    // Every sign() call in AuthService passes its own expiresIn, so a default
    // here would look authoritative while being ignored.
    setEnv(REAL_SECRET, 'development');
    expect(jwtModuleOptions()).toEqual({ secret: REAL_SECRET });
  });
});
