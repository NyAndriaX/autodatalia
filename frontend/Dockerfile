# Use the official Node.js active LTS image as the base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (ci ensures clean, repeatable install)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Set environment to production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the optimized production bundle
RUN npm run build

# Expose port 3000
EXPOSE 3000

# Start the Next.js production server
CMD ["npm", "run", "start"]
