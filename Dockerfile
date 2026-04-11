FROM node:24-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --chown=appuser:appgroup package*.json ./
RUN npm ci

COPY --chown=appuser:appgroup . .

EXPOSE 3000

USER appuser

CMD ["sh", "-c", "npm run migrate:up && node server/index.js"]
