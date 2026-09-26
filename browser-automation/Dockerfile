FROM node:18-bullseye-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies as root (needed for install-deps later)
RUN npm install

# Install Playwright system dependencies
RUN npx playwright install-deps chromium

# Create non-root user and give ownership of /app
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Install Playwright browsers
RUN npx playwright install chromium

# Copy application code
COPY --chown=appuser:appuser . .

EXPOSE 3001

CMD ["node", "src/index.js"]