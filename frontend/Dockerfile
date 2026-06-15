# Use the official Node.js active LTS image as the base
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application files
COPY . .

# Set environment to production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Accept build arguments for Next.js static embedding
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# Proxy target for the /api/backend rewrite. Next.js bakes rewrite destinations
# at BUILD time, so this MUST be present here (not only at runtime) or the
# rewrite resolves to "/api/backend" itself and every API call 404s.
ARG INTERNAL_API_BASE_URL=http://caption-api:8000
ENV INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL}

# Build the optimized production bundle
RUN npm run build

# Expose port 3000
EXPOSE 3000

# Start the Next.js production server
CMD ["npm", "run", "start"]
