import * as Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  PORT: Joi.number().default(3000),
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
  SEED_ON_START: Joi.string().valid('true', 'false').default('false'),
  TRUST_PROXY: Joi.string().valid('true', 'false').default('false'),
});
