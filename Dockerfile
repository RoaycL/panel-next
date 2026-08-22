# build frontend
FROM node AS web_image

RUN npm install pnpm -g

WORKDIR /build

COPY ./package.json /build

COPY ./pnpm-lock.yaml /build

RUN pnpm install

COPY . /build

RUN pnpm run build

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

EXPOSE 3002 3003

RUN apk add --no-cache bash ca-certificates su-exec tzdata \
    && chmod +x ./panel-next \
    && ./panel-next -config

CMD ./panel-next
