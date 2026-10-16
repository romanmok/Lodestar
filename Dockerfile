FROM node:24-alpine
WORKDIR /app
COPY . .
# /data must be writable by the unprivileged node user (also when a named volume is first created)
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data PORT=8080 HOST=0.0.0.0
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
