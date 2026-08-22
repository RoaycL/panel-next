#!/bin/bash

REPO=$(
  cd "$(dirname "$0")"
  pwd
)
COMMIT_SHA=$(git rev-parse --short HEAD)
VERSION="v$(cut -d '|' -f 2 "$REPO/service/assets/version")"
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
FRONTEND="false"
RELEASE="false"

debugInfo() {
  echo "Repo:           $REPO"
  echo "Build frontend:   $FRONTEND"
  echo "Release:        $RELEASE"
  echo "Version:        $VERSION"
  echo "Commit:        $COMMIT_SHA"
  echo "LATEST_TAG:        $LATEST_TAG"
}

buildFrontend() {
  cd "$REPO"
  pnpm install
  pnpm run build
}

buildBackEndAssets() {
  cd "$REPO/service"
  go install github.com/go-bindata/go-bindata/...@latest
  go-bindata -o=assets/bindata.go -pkg=assets assets/...
}

# buildBinary() {
#   cd $REPO/service
#   # mv "${REPO}/dist" "${REPO}/web"
#   go build -o "panel-next" --ldflags="-X panel-next/global.RUNCODE=release" main.go
# }

_build() {
  cd "$REPO/service"
  local osarch=$1
  IFS=/ read -r -a arr <<<"$osarch"
  os="${arr[0]}"
  arch="${arr[1]}"
  gcc="${arr[2]}"

  # Go build to build the binary.
  export GOOS=$os
  export GOARCH=$arch
  export CC=$gcc
  export CGO_ENABLED=1

  pathRelease=$REPO/release

  if [ -n "$VERSION" ]; then
    outPath="panel-next_${VERSION}_${os}_${arch}"
  elif [ -n "$LATEST_TAG" ]; then
    outPath="panel-next_${LATEST_TAG}_${os}_${arch}"
  else
    outPath="panel-next_${COMMIT_SHA}_${os}_${arch}"
  fi
  outname="${pathRelease}/${outPath}/panel-next"
  go build -o "${outname}" --ldflags="-X panel-next/global.RUNCODE=release" main.go

  cd "$pathRelease"
  # copy front file
  cp -r "${REPO}/dist" "${pathRelease}/${outPath}/web"

  echo "Release ${outPath}"
  if [ "$os" = "windows" ]; then
    mv "$outname" "$outPath/panel-next.exe"
    zip -r "${pathRelease}/${outPath}.zip" "$outPath"
  else
    mv "$outname" "$outPath/panel-next"
    tar -zcvf "${pathRelease}/${outPath}.tar.gz" "$outPath"
  fi
  rm -rf "${pathRelease}/${outPath}"
}

# 构建 Linux musl 静态二进制（参考 Alist 构建方案）
buildReleaseLinuxMusl() {
  cd "$REPO/service"
  ldflags="-X panel-next/global.RUNCODE=release"
  pathRelease=$REPO/release
  muslflags="--extldflags '-static -fpic' $ldflags"
  BASE="https://musl.nn.ci/"
  FILES=(x86_64-linux-musl-cross)
  for i in "${FILES[@]}"; do
    url="${BASE}${i}.tgz"
    curl -L -o "${i}.tgz" "${url}"
    tar xf "${i}.tgz" --strip-components 1 -C /usr/local
    rm -f "${i}.tgz"
  done
  # 暂时仅编译 amd64
  OS_ARCHES=(linux-musl-amd64)
  CGO_ARGS=(x86_64-linux-musl-gcc)

  for i in "${!OS_ARCHES[@]}"; do
    os_arch=${OS_ARCHES[$i]}
    cgo_cc=${CGO_ARGS[$i]}
    echo building for ${os_arch}
    export GOOS=${os_arch%%-*}
    export GOARCH=${os_arch##*-}
    export CC=${cgo_cc}
    export CGO_ENABLED=1

    if [ -n "$VERSION" ]; then
      outPath="panel-next_${VERSION}_${GOOS}_musl_${GOARCH}"
    elif [ -n "$LATEST_TAG" ]; then
      outPath="panel-next_${LATEST_TAG}_${GOOS}_musl_${GOARCH}"
    else
      outPath="panel-next_${COMMIT_SHA}_${GOOS}_musl_${GOARCH}"
    fi

    outname="${pathRelease}/${outPath}/panel-next"

    go build -o "${outname}" -ldflags="$muslflags" main.go
  done

  cd "$pathRelease"
  # copy front file
  cp -r "${REPO}/dist" "${pathRelease}/${outPath}/web"

  echo "Release ${outPath}"

  mv "$outname" "$outPath/panel-next"
  tar -zcvf "${pathRelease}/${outPath}.tar.gz" "$outPath"

  rm -rf "${pathRelease}/${outPath}"
}

release() {
  cd "$REPO/service"
  ## List of architectures and OS to test cross compilation.
  SUPPORTED_OSARCH="linux/amd64/gcc linux/arm/arm-linux-gnueabihf-gcc windows/amd64/x86_64-w64-mingw32-gcc linux/arm64/aarch64-linux-gnu-gcc"

  echo "Release builds for OS/Arch/CC: ${SUPPORTED_OSARCH}"
  for each_osarch in ${SUPPORTED_OSARCH}; do
    _build "${each_osarch}"
  done

  # 临时方案解决 centos 无法运行的问题
  buildReleaseLinuxMusl
}

usage() {
  echo "Usage: $0 [-f] [-r] [-d]" 1>&2
  exit 1
}

while getopts "frd" o; do
  case "${o}" in
  f)
    FRONTEND="true"
    ;;
  r)
    FRONTEND="true"
    RELEASE="true"
    ;;
  d)
    DEBUG="true"
    ;;
  *)
    usage
    ;;
  esac
done
shift $((OPTIND - 1))

if [ "$DEBUG" = "true" ]; then
  debugInfo
fi

if [ "$FRONTEND" = "true" ]; then
  buildFrontend
fi

if [ "$RELEASE" = "true" ]; then
  buildBackEndAssets
  release
fi
