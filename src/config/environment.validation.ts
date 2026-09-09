import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  JWT_SECRET: Joi.string()
    .min(32)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.invalid(
        'replace-with-a-secret-of-at-least-32-characters',
        'development-only-change-me-please',
      ),
    })
    .required(),
  PORT: Joi.number().default(3000),
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
  SEED_ON_START: Joi.string().valid('true', 'false').default('false'),
  TRUST_PROXY: Joi.string().valid('true', 'false').default('false'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
});
