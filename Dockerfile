FROM node:24-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --non-interactive

COPY --chown=node:node src ./src

ENV NODE_ENV=production
ENV PORT=3000

USER node
EXPOSE 3000

CMD ["yarn", "start"]
