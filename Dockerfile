FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
