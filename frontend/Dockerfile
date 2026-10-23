# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ── Runtime stage (nginx) ────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copiem build-ul
COPY --from=builder /app/dist /usr/share/nginx/html

# Configurare nginx pentru SPA (react-router)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
