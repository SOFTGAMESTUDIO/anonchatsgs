# Use lightweight Node image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --production

# Copy the rest of the source code
COPY . .

# Cloud Run requires port 8080
EXPOSE 8080

# Start the server
CMD ["npm", "start"]
