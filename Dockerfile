FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript using npx (avoids permission issues)
RUN npx tsc

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
