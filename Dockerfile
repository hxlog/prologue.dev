# syntax=docker/dockerfile:1
# Production image for the self-hosted Next.js server (Fly.io).
#
# The build MUST run on Linux: Next traces the Linux sharp binaries
# (@img/sharp-linux-x64) and the Linux SWC binary into .next/standalone. The
# host checkout's node_modules are Windows-only, which is why install happens
# inside the image rather than in the build context.

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    YARN_ENABLE_TELEMETRY=0
# Corepack drives the Yarn 4 release pinned by package.json#packageManager.
# Node 24 still bundles it; fall back to the npm-published one if a future base
# image drops it.
RUN corepack enable 2>/dev/null || (npm i -g corepack@latest && corepack enable)
WORKDIR /app

FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

FROM deps AS build
COPY . .
# Version-skew protection: one id per release, identical at build and runtime.
ARG DEPLOYMENT_ID=""
ENV DEPLOYMENT_ID=${DEPLOYMENT_ID}
ENV NEXT_STANDALONE=1
# Runs scripts/build-search-index.mjs (writes public/search-index.json and the
# image-size map) and then `next build --turbopack`.
RUN yarn build

FROM base AS runner
WORKDIR /app
ARG DEPLOYMENT_ID=""
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    DEPLOYMENT_ID=${DEPLOYMENT_ID}
# Standalone bundle + the two directories Next deliberately does not copy.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The probe image ran as root on a single-tenant Fly Machine; keeping root avoids
# a duplicated chown layer and the image stays lean for the 256 MB machine.
EXPOSE 8080
CMD ["node", "server.js"]
