import { environmentValidationSchema } from '../src/config/environment.validation';

const base = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/proxion',
  JWT_SECRET: 'a-secure-development-secret-that-is-long-enough',
};

describe('environment validation', () => {
  it('disables Swagger by default', () => {
    const { error, value } = environmentValidationSchema.validate(base);

    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });

  it('rejects the documented placeholder secret in production', () => {
    const { error } = environmentValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
      JWT_SECRET: 'replace-with-a-secret-of-at-least-32-characters',
    });

    expect(error).toBeDefined();
  });
});
