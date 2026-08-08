FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=8090
ENV DB_PATH=/app/data/routemaster.db
EXPOSE 8090
CMD ["node", "server.js"]
