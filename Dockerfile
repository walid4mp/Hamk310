FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json ./package.json
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/prisma ./prisma
COPY backend/src ./src
RUN npm install && npx prisma generate && npm run build
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma db push && npm run seed && node dist/src/server.js"]
