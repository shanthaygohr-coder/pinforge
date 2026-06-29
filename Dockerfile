# ---- Build ----
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build

# ---- Runtime ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 3000
# La pornire creeaza/actualizeaza tabelele din schema (fara fisiere de migrare) apoi porneste serverul.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
