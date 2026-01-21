FROM denoland/deno:2.6.1

WORKDIR /app

# Copy all source files
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/

# Cache dependencies
RUN deno cache main.ts

# Run as non-root user (deno user is provided by the base image)
USER deno

# The MCP server uses stdio transport
CMD ["deno", "run", "--allow-net", "--allow-env", "main.ts"]
