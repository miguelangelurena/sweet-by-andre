FROM node:24-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG ENABLE_STRIPE_CHECKOUT=false
ENV VITE_APP_ENV=staging VITE_ENABLE_STRIPE_CHECKOUT=${ENABLE_STRIPE_CHECKOUT} VITE_API_URL=/api
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production APP_ENV=staging SERVE_FRONTEND=true \
    ENABLE_STRIPE_CHECKOUT=false ENABLE_TRANSACTIONAL_NOTIFICATIONS=false ENABLE_TRANSACTIONAL_SMS=false
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/ ./
COPY --from=frontend-build --chown=node:node /build/frontend/dist /app/frontend/dist
USER node
EXPOSE 5000
CMD ["node", "server.js"]
