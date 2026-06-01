# Standalone feed service image. Build context is this feed/ directory:
#   docker build -t transit-daw-feed feed/
#   docker run -p 3005:3005 --env-file feed/.env transit-daw-feed
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV PORT=3005
EXPOSE 3005

CMD ["node", "index.js"]
