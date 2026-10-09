# build frontend
FROM node:22 AS web_image

RUN npm install pnpm@11.20.0 -g

WORKDIR /build

COPY ./package.json /build

COPY ./pnpm-lock.yaml /build

COPY ./pnpm-workspace.yaml /build

COPY ./patches /build/patches

RUN pnpm install

COPY . /build

RUN pnpm run type-check && pnpm run build:web

# build backend
FROM golang:1.21-alpine3.18 as server_image

WORKDIR /build

COPY ./service .

RUN apk add --no-cache bash curl gcc git musl-dev

RUN go env -w GO111MODULE=on \
    && export PATH=$PATH:/go/bin \
    && go install github.com/go-bindata/go-bindata/...@latest \
    && go-bindata -o=assets/bindata.go -pkg=assets assets/conf.example.ini assets/lang/en-us.ini assets/lang/zh-cn.ini assets/readme.md assets/version \
    && go build -o panel-next --ldflags="-X panel-next/global.RUNCODE=release -X panel-next/global.ISDOCKER=docker" main.go

# run_image
FROM alpine

WORKDIR /app

COPY --from=web_image /build/dist /app/web

COPY --from=server_image /build/panel-next /app/panel-next
COPY ./LICENSE /app/LICENSE

EXPOSE 3002

# conf/conf.ini is generated on first start (SQLite by default), so a mounted
# conf/ volume is filled instead of being shadowed by a build-time file.
RUN apk add --no-cache bash ca-certificates su-exec tzdata \
    && chmod +x ./panel-next

CMD ./panel-next
