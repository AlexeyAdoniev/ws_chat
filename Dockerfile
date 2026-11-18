FROM node:24-alpine AS build

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:24-alpine

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --non-interactive
COPY --from=build --chown=node:node /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

USER node
EXPOSE 3000

CMD ["yarn", "start"]
