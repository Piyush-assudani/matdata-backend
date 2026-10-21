const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Structured JSON logging for production
  ),
  defaultMeta: { service: 'voter-management-api' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json() // JSON for Grafana/Sentry in prod
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple() // Pretty print for local dev
          ),
    }),
  ],
});

module.exports = logger;
