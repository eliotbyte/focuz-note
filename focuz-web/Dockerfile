# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG NGINX_IMAGE=nginx:1.30-alpine

# 1) Dependencies layer
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use ci if lockfile exists, otherwise install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# 2) Build layer
FROM deps AS build
WORKDIR /app
COPY . .
# Pass-through Vite envs at build time if provided
ARG VITE_API_BASE_URL
ARG VITE_APP_ENV
ARG VITE_SYNC_INTERVAL_MS
ARG VITE_SYNC_DEBOUNCE_MS
ARG VITE_SYNC_WS_COOLDOWN_MS
ARG VITE_SYNC_BACKOFF_MS
# "false": people cannot point this web app at another server (only VITE_API_BASE_URL is used)
ARG VITE_ALLOW_CUSTOM_SERVER=true
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_ENV=${VITE_APP_ENV}
ENV VITE_SYNC_INTERVAL_MS=${VITE_SYNC_INTERVAL_MS}
ENV VITE_SYNC_DEBOUNCE_MS=${VITE_SYNC_DEBOUNCE_MS}
ENV VITE_SYNC_WS_COOLDOWN_MS=${VITE_SYNC_WS_COOLDOWN_MS}
ENV VITE_SYNC_BACKOFF_MS=${VITE_SYNC_BACKOFF_MS}
ENV VITE_ALLOW_CUSTOM_SERVER=${VITE_ALLOW_CUSTOM_SERVER}
ENV NODE_ENV=production
RUN npm run build

# 3) Runtime with nginx
FROM ${NGINX_IMAGE} AS runner
# Our site (SPA fallback, caching, security headers) replaces the default one.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Default command provided by nginx image 