FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca if [ -f /run/secrets/build_ca ]; then npm_config_cafile=/run/secrets/build_ca npm ci; else npm ci; fi
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_PORTAL_MODE=customer
ARG NEXT_PUBLIC_CUSTOMER_URL
ARG BUILD_DIR=.next
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_PORTAL_MODE=$NEXT_PUBLIC_PORTAL_MODE NEXT_PUBLIC_CUSTOMER_URL=$NEXT_PUBLIC_CUSTOMER_URL NEXT_DIST_DIR=$BUILD_DIR NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG BUILD_DIR=.next
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=$BUILD_DIR HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/$BUILD_DIR/standalone ./
COPY --from=builder --chown=node:node /app/$BUILD_DIR/static ./$BUILD_DIR/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
